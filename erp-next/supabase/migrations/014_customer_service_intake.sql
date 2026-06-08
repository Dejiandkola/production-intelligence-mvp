-- Migration 014: Customer Service intake workflow.
--
-- Customer Service owns ticket/item intake. Items created by this workflow start
-- at NEW, then Production moves them into production by assigning work.

INSERT INTO public.permissions (name)
VALUES ('manage_customer_service')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.roles (organization_id, name)
SELECT id, 'customer_service'
FROM public.organizations
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name = 'manage_customer_service'
WHERE r.name IN ('customer_service', 'Admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

DROP POLICY IF EXISTS "Write tickets" ON public.tickets;
DROP POLICY IF EXISTS "Update tickets" ON public.tickets;
DROP POLICY IF EXISTS "Delete tickets" ON public.tickets;
DROP POLICY IF EXISTS "tickets_insert_manage" ON public.tickets;
DROP POLICY IF EXISTS "tickets_insert_manage_production" ON public.tickets;
DROP POLICY IF EXISTS "tickets_update_manage" ON public.tickets;
DROP POLICY IF EXISTS "tickets_delete_manage" ON public.tickets;

CREATE POLICY "tickets_insert_customer_service"
ON public.tickets
FOR INSERT
WITH CHECK (
  organization_id = public.current_org_id()
  AND public.has_permission('manage_customer_service')
);

CREATE POLICY "tickets_update_customer_service_new_only"
ON public.tickets
FOR UPDATE
USING (
  organization_id = public.current_org_id()
  AND public.has_permission('manage_customer_service')
  AND NOT EXISTS (
    SELECT 1
    FROM public.items i
    WHERE i.ticket_id = tickets.id
      AND i.organization_id = tickets.organization_id
      AND i.status <> 'NEW'
  )
)
WITH CHECK (
  organization_id = public.current_org_id()
  AND public.has_permission('manage_customer_service')
);

CREATE POLICY "tickets_delete_customer_service_new_only"
ON public.tickets
FOR DELETE
USING (
  organization_id = public.current_org_id()
  AND public.has_permission('manage_customer_service')
  AND NOT EXISTS (
    SELECT 1
    FROM public.items i
    WHERE i.ticket_id = tickets.id
      AND i.organization_id = tickets.organization_id
      AND i.status <> 'NEW'
  )
);

DROP POLICY IF EXISTS "Write items" ON public.items;
DROP POLICY IF EXISTS "Update items" ON public.items;
DROP POLICY IF EXISTS "Delete items" ON public.items;
DROP POLICY IF EXISTS "items_insert" ON public.items;
DROP POLICY IF EXISTS "items_insert_manage" ON public.items;
DROP POLICY IF EXISTS "items_insert_manage_production" ON public.items;
DROP POLICY IF EXISTS "items_update" ON public.items;
DROP POLICY IF EXISTS "items_update_manage" ON public.items;
DROP POLICY IF EXISTS "items_delete" ON public.items;
DROP POLICY IF EXISTS "items_delete_manage" ON public.items;

CREATE POLICY "items_insert_customer_service_new"
ON public.items
FOR INSERT
WITH CHECK (
  organization_id = public.current_org_id()
  AND public.has_permission('manage_customer_service')
  AND status = 'NEW'
);

CREATE POLICY "items_update_operational"
ON public.items
FOR UPDATE
USING (
  organization_id = public.current_org_id()
  AND (
    public.has_permission('manage_production')
    OR public.has_permission('manage_qc')
    OR public.has_permission('manage_completion')
    OR (
      public.has_permission('manage_customer_service')
      AND status = 'NEW'
    )
  )
)
WITH CHECK (
  organization_id = public.current_org_id()
  AND (
    public.has_permission('manage_production')
    OR public.has_permission('manage_qc')
    OR public.has_permission('manage_completion')
    OR (
      public.has_permission('manage_customer_service')
      AND status = 'NEW'
    )
  )
);

CREATE POLICY "items_delete_customer_service_new_only"
ON public.items
FOR DELETE
USING (
  organization_id = public.current_org_id()
  AND public.has_permission('manage_customer_service')
  AND status = 'NEW'
);

CREATE OR REPLACE FUNCTION public.create_work_assignment(
  p_item_id uuid,
  p_category_type_id uuid,
  p_task_type_id uuid,
  p_tailor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_product_type_id uuid;
  v_band tailor_band;
  v_rate numeric(12,2);
  v_assignment_id uuid;
  v_item_status item_status;
BEGIN
  IF NOT (public.has_permission('manage_production') OR public.has_permission('manage_qc')) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT product_type_id, status
  INTO v_product_type_id, v_item_status
  FROM public.items
  WHERE id = p_item_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  IF v_item_status IN ('CANCELLED', 'ARCHIVED', 'OUT_OF_PRODUCTION') THEN
    RAISE EXCEPTION 'Cannot assign work on item with status %', v_item_status;
  END IF;

  SELECT band
  INTO v_band
  FROM public.tailors
  WHERE id = p_tailor_id AND organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tailor not found';
  END IF;

  IF v_band = 'A' THEN
    SELECT band_a_fee INTO v_rate
    FROM public.rate_cards
    WHERE organization_id = v_org_id
      AND task_type_id = p_task_type_id
      AND category_type_id = p_category_type_id
      AND product_type_id = v_product_type_id;
  ELSE
    SELECT band_b_fee INTO v_rate
    FROM public.rate_cards
    WHERE organization_id = v_org_id
      AND task_type_id = p_task_type_id
      AND category_type_id = p_category_type_id
      AND product_type_id = v_product_type_id;
  END IF;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'Rate card not found for this task and product';
  END IF;

  INSERT INTO public.work_assignments (
    organization_id, item_id, category_type_id, task_type_id,
    tailor_id, status, pay_band_snapshot, rate_snapshot, pay_amount
  ) VALUES (
    v_org_id, p_item_id, p_category_type_id, p_task_type_id,
    p_tailor_id, 'CREATED', v_band, v_rate, v_rate
  )
  ON CONFLICT (organization_id, item_id, category_type_id, task_type_id)
  DO UPDATE SET tailor_id = EXCLUDED.tailor_id
  RETURNING id INTO v_assignment_id;

  IF v_item_status = 'NEW' THEN
    UPDATE public.items
    SET status = 'IN_PRODUCTION'
    WHERE id = p_item_id AND organization_id = v_org_id;
  END IF;

  RETURN v_assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_item_to_new(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_item_status item_status;
BEGIN
  IF NOT public.has_permission('manage_production') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT status
  INTO v_item_status
  FROM public.items
  WHERE id = p_item_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  IF v_item_status <> 'IN_PRODUCTION' THEN
    RAISE EXCEPTION 'Only IN_PRODUCTION items can be returned to NEW';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.work_assignments
    WHERE item_id = p_item_id
      AND organization_id = v_org_id
      AND status <> 'CREATED'
  ) THEN
    RAISE EXCEPTION 'Cannot return item to NEW because work has already progressed';
  END IF;

  DELETE FROM public.work_assignments
  WHERE item_id = p_item_id
    AND organization_id = v_org_id
    AND status = 'CREATED';

  UPDATE public.items
  SET status = 'NEW'
  WHERE id = p_item_id AND organization_id = v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.return_item_to_new(uuid) TO authenticated;
