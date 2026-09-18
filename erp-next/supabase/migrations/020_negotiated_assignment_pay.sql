-- Migration 020: Negotiated assignment pay.
--
-- Production can request a price review on an assigned task.
-- Accounts can set or clear a negotiated price before the task is approved.
-- Payroll continues to read work_assignments.pay_amount as the final payable amount.

ALTER TABLE public.work_assignments
ADD COLUMN IF NOT EXISTS pay_source text NOT NULL DEFAULT 'RATE_CARD',
ADD COLUMN IF NOT EXISTS price_review_requested boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS price_review_reason text,
ADD COLUMN IF NOT EXISTS price_review_requested_by uuid,
ADD COLUMN IF NOT EXISTS price_review_requested_at timestamptz,
ADD COLUMN IF NOT EXISTS price_review_resolved_at timestamptz,
ADD COLUMN IF NOT EXISTS negotiated_pay_amount numeric(12,2),
ADD COLUMN IF NOT EXISTS negotiated_price_note text,
ADD COLUMN IF NOT EXISTS negotiated_price_set_by uuid,
ADD COLUMN IF NOT EXISTS negotiated_price_set_at timestamptz;

UPDATE public.work_assignments
SET pay_source = CASE
  WHEN pay_amount IS DISTINCT FROM rate_snapshot THEN 'SPECIAL_PAY'
  ELSE 'RATE_CARD'
END
WHERE pay_source IS DISTINCT FROM 'NEGOTIATED_PRICE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'work_assignments_pay_source_check'
      AND conrelid = 'public.work_assignments'::regclass
  ) THEN
    ALTER TABLE public.work_assignments
    ADD CONSTRAINT work_assignments_pay_source_check
    CHECK (pay_source IN ('RATE_CARD', 'SPECIAL_PAY', 'NEGOTIATED_PRICE'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'work_assignments_negotiated_pay_amount_nonnegative'
      AND conrelid = 'public.work_assignments'::regclass
  ) THEN
    ALTER TABLE public.work_assignments
    ADD CONSTRAINT work_assignments_negotiated_pay_amount_nonnegative
    CHECK (negotiated_pay_amount IS NULL OR negotiated_pay_amount >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS work_assignments_price_review_idx
ON public.work_assignments (organization_id, status, price_review_requested)
WHERE price_review_requested = true;

CREATE OR REPLACE FUNCTION public.enforce_work_assignment_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Pay snapshots may only be recalculated while the assignment is still editable.
  IF TG_OP = 'UPDATE' THEN
    IF (
      NEW.pay_band_snapshot IS DISTINCT FROM OLD.pay_band_snapshot
      OR NEW.rate_snapshot IS DISTINCT FROM OLD.rate_snapshot
      OR NEW.pay_amount IS DISTINCT FROM OLD.pay_amount
      OR NEW.pay_source IS DISTINCT FROM OLD.pay_source
      OR NEW.negotiated_pay_amount IS DISTINCT FROM OLD.negotiated_pay_amount
      OR NEW.negotiated_price_note IS DISTINCT FROM OLD.negotiated_price_note
    ) AND OLD.status::text <> 'CREATED' THEN
      RAISE EXCEPTION 'Pay fields are immutable after work assignment progresses';
    END IF;
  END IF;

  -- After PAID: block edits unless status moves to REVERSED.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status::text = 'PAID' AND NEW.status::text <> 'REVERSED' THEN
      RAISE EXCEPTION 'Cannot modify a PAID work_assignment except via reversal';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

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
  v_assignment_id uuid;
  v_item_status item_status;
  v_pay record;
  v_pay_source text;
BEGIN
  IF NOT (public.has_permission('manage_production') OR public.has_permission('manage_qc')) THEN
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

  IF v_item_status IN ('CANCELLED', 'ARCHIVED', 'OUT_OF_PRODUCTION') THEN
    RAISE EXCEPTION 'Cannot assign work on item with status %', v_item_status;
  END IF;

  SELECT *
  INTO v_pay
  FROM public.calculate_assignment_pay(
    p_item_id,
    p_category_type_id,
    p_task_type_id,
    p_tailor_id
  );

  v_pay_source := CASE
    WHEN v_pay.special_fee IS NOT NULL THEN 'SPECIAL_PAY'
    ELSE 'RATE_CARD'
  END;

  INSERT INTO public.work_assignments (
    organization_id, item_id, category_type_id, task_type_id,
    tailor_id, status, pay_band_snapshot, rate_snapshot, pay_amount,
    pay_source, price_review_requested, price_review_reason,
    price_review_requested_by, price_review_requested_at, price_review_resolved_at,
    negotiated_pay_amount, negotiated_price_note, negotiated_price_set_by,
    negotiated_price_set_at
  ) VALUES (
    v_org_id, p_item_id, p_category_type_id, p_task_type_id,
    p_tailor_id, 'CREATED', v_pay.pay_band, v_pay.base_fee, v_pay.final_fee,
    v_pay_source, false, NULL,
    NULL, NULL, NULL,
    NULL, NULL, NULL,
    NULL
  )
  ON CONFLICT (organization_id, item_id, category_type_id, task_type_id)
  DO UPDATE SET
    tailor_id = EXCLUDED.tailor_id,
    pay_band_snapshot = EXCLUDED.pay_band_snapshot,
    rate_snapshot = EXCLUDED.rate_snapshot,
    pay_amount = EXCLUDED.pay_amount,
    pay_source = EXCLUDED.pay_source,
    price_review_requested = false,
    price_review_reason = NULL,
    price_review_requested_by = NULL,
    price_review_requested_at = NULL,
    price_review_resolved_at = NULL,
    negotiated_pay_amount = NULL,
    negotiated_price_note = NULL,
    negotiated_price_set_by = NULL,
    negotiated_price_set_at = NULL
  RETURNING id INTO v_assignment_id;

  IF v_item_status = 'NEW' THEN
    UPDATE public.items
    SET status = 'IN_PRODUCTION'
    WHERE id = p_item_id AND organization_id = v_org_id;
  END IF;

  RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_work_assignment(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_work_assignment(uuid, uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_work_assignment(
  p_assignment_id uuid,
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
  v_item_id uuid;
  v_status text;
  v_pay record;
  v_pay_source text;
BEGIN
  IF NOT (public.has_permission('manage_production') OR public.has_permission('manage_qc')) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT wa.item_id, wa.status::text
  INTO v_item_id, v_status
  FROM public.work_assignments wa
  WHERE wa.id = p_assignment_id
    AND wa.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work assignment not found';
  END IF;

  IF v_status IN ('QC_PASSED', 'QC_FAILED', 'PAID', 'REVERSED') THEN
    RAISE EXCEPTION 'Cannot edit this task because it has already progressed beyond assignment';
  END IF;

  IF v_status <> 'CREATED' THEN
    RAISE EXCEPTION 'Cannot edit this task. Current status: %', v_status;
  END IF;

  SELECT *
  INTO v_pay
  FROM public.calculate_assignment_pay(
    v_item_id,
    p_category_type_id,
    p_task_type_id,
    p_tailor_id
  );

  v_pay_source := CASE
    WHEN v_pay.special_fee IS NOT NULL THEN 'SPECIAL_PAY'
    ELSE 'RATE_CARD'
  END;

  UPDATE public.work_assignments
  SET
    category_type_id = p_category_type_id,
    task_type_id = p_task_type_id,
    tailor_id = p_tailor_id,
    pay_band_snapshot = v_pay.pay_band,
    rate_snapshot = v_pay.base_fee,
    pay_amount = v_pay.final_fee,
    pay_source = v_pay_source,
    price_review_requested = false,
    price_review_reason = NULL,
    price_review_requested_by = NULL,
    price_review_requested_at = NULL,
    price_review_resolved_at = NULL,
    negotiated_pay_amount = NULL,
    negotiated_price_note = NULL,
    negotiated_price_set_by = NULL,
    negotiated_price_set_at = NULL
  WHERE id = p_assignment_id
    AND organization_id = v_org_id;

  RETURN p_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_work_assignment(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_work_assignment(uuid, uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_assignment_price_review(
  p_assignment_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_status text;
  v_reason text := NULLIF(trim(p_reason), '');
BEGIN
  IF NOT (public.has_permission('manage_production') OR public.has_permission('manage_qc')) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Price review reason is required';
  END IF;

  SELECT wa.status::text
  INTO v_status
  FROM public.work_assignments wa
  WHERE wa.id = p_assignment_id
    AND wa.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work assignment not found';
  END IF;

  IF v_status <> 'CREATED' THEN
    RAISE EXCEPTION 'Only pending tasks can be sent for price review';
  END IF;

  UPDATE public.work_assignments
  SET
    price_review_requested = true,
    price_review_reason = v_reason,
    price_review_requested_by = auth.uid(),
    price_review_requested_at = now(),
    price_review_resolved_at = NULL
  WHERE id = p_assignment_id
    AND organization_id = v_org_id;

  RETURN p_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_assignment_price_review(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_assignment_price_review(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_assignment_negotiated_price(
  p_assignment_id uuid,
  p_negotiated_pay_amount numeric,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_status text;
  v_note text := NULLIF(trim(COALESCE(p_note, '')), '');
BEGIN
  IF NOT (public.has_permission('manage_payments') OR public.has_permission('admin')) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_negotiated_pay_amount IS NULL OR p_negotiated_pay_amount < 0 THEN
    RAISE EXCEPTION 'Negotiated price must be zero or higher';
  END IF;

  SELECT wa.status::text
  INTO v_status
  FROM public.work_assignments wa
  WHERE wa.id = p_assignment_id
    AND wa.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work assignment not found';
  END IF;

  IF v_status <> 'CREATED' THEN
    RAISE EXCEPTION 'Negotiated price can only be changed before approval';
  END IF;

  UPDATE public.work_assignments
  SET
    negotiated_pay_amount = p_negotiated_pay_amount,
    negotiated_price_note = v_note,
    negotiated_price_set_by = auth.uid(),
    negotiated_price_set_at = now(),
    pay_amount = p_negotiated_pay_amount,
    pay_source = 'NEGOTIATED_PRICE',
    price_review_requested = false,
    price_review_resolved_at = now()
  WHERE id = p_assignment_id
    AND organization_id = v_org_id;

  RETURN p_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_assignment_negotiated_price(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_assignment_negotiated_price(uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_assignment_negotiated_price(
  p_assignment_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_item_id uuid;
  v_category_type_id uuid;
  v_task_type_id uuid;
  v_tailor_id uuid;
  v_status text;
  v_pay record;
  v_pay_source text;
BEGIN
  IF NOT (public.has_permission('manage_payments') OR public.has_permission('admin')) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT
    wa.item_id,
    wa.category_type_id,
    wa.task_type_id,
    wa.tailor_id,
    wa.status::text
  INTO
    v_item_id,
    v_category_type_id,
    v_task_type_id,
    v_tailor_id,
    v_status
  FROM public.work_assignments wa
  WHERE wa.id = p_assignment_id
    AND wa.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work assignment not found';
  END IF;

  IF v_status <> 'CREATED' THEN
    RAISE EXCEPTION 'Negotiated price can only be cleared before approval';
  END IF;

  SELECT *
  INTO v_pay
  FROM public.calculate_assignment_pay(
    v_item_id,
    v_category_type_id,
    v_task_type_id,
    v_tailor_id
  );

  v_pay_source := CASE
    WHEN v_pay.special_fee IS NOT NULL THEN 'SPECIAL_PAY'
    ELSE 'RATE_CARD'
  END;

  UPDATE public.work_assignments
  SET
    pay_band_snapshot = v_pay.pay_band,
    rate_snapshot = v_pay.base_fee,
    pay_amount = v_pay.final_fee,
    pay_source = v_pay_source,
    negotiated_pay_amount = NULL,
    negotiated_price_note = NULL,
    negotiated_price_set_by = NULL,
    negotiated_price_set_at = NULL,
    price_review_requested = false,
    price_review_resolved_at = now()
  WHERE id = p_assignment_id
    AND organization_id = v_org_id;

  RETURN p_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_assignment_negotiated_price(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_assignment_negotiated_price(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_ticket_paginated_items(
  p_ticket_search text DEFAULT NULL,
  p_customer_search text DEFAULT NULL,
  p_product_type text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_receiving_status text DEFAULT NULL,
  p_exclude_cancelled boolean DEFAULT false,
  p_exclude_archived boolean DEFAULT false,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS TABLE (
  item jsonb,
  total_tickets bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered_items AS (
    SELECT
      i.*,
      tk.ticket_number,
      tk.customer_name,
      pt.name AS product_type_name
    FROM public.items i
    JOIN public.tickets tk ON tk.id = i.ticket_id
    JOIN public.product_types pt ON pt.id = i.product_type_id
    WHERE i.organization_id = public.current_org_id()
      AND (p_ticket_search IS NULL OR tk.ticket_number ILIKE '%' || p_ticket_search || '%' OR i.item_key ILIKE '%' || p_ticket_search || '%')
      AND (p_customer_search IS NULL OR tk.customer_name ILIKE '%' || p_customer_search || '%')
      AND (p_product_type IS NULL OR pt.name = p_product_type)
      AND (
        p_category IS NULL OR EXISTS (
          SELECT 1
          FROM public.work_assignments w
          JOIN public.category_types ct ON ct.id = w.category_type_id
          WHERE w.item_id = i.id
            AND w.organization_id = public.current_org_id()
            AND ct.name = p_category
        )
      )
      AND (
        p_status IS NULL
        OR i.status::text = p_status
        OR (p_status = 'OUT_OF_PRODUCTION' AND i.status::text = 'COMPLETED')
        OR (p_status = 'IN_PRODUCTION' AND i.status::text = 'IN_QC')
      )
      AND (p_start_date IS NULL OR i.created_at >= p_start_date)
      AND (p_end_date IS NULL OR i.created_at <= p_end_date)
      AND (p_receiving_status IS NULL OR (CASE WHEN i.is_received THEN 'Received' ELSE 'Not Received' END) = p_receiving_status)
      AND (NOT p_exclude_cancelled OR i.status::text <> 'CANCELLED')
      AND (NOT p_exclude_archived OR i.status::text <> 'ARCHIVED')
  ),
  ticket_totals AS (
    SELECT COUNT(*)::bigint AS total_tickets
    FROM (SELECT DISTINCT ticket_id FROM filtered_items) tickets
  ),
  ticket_page AS (
    SELECT ticket_id
    FROM filtered_items
    GROUP BY ticket_id
    ORDER BY MAX(created_at) DESC, MAX(ticket_number) DESC
    LIMIT GREATEST(1, p_page_size)
    OFFSET GREATEST(0, (GREATEST(1, p_page) - 1) * GREATEST(1, p_page_size))
  )
  SELECT
    to_jsonb(fi) ||
    jsonb_build_object(
      'raw_status', fi.status,
      'receiving_status', CASE WHEN fi.is_received THEN 'Received' ELSE 'Not Received' END,
      'work_assignments', COALESCE(wa.assignments, '[]'::jsonb)
    ) AS item,
    tt.total_tickets
  FROM filtered_items fi
  JOIN ticket_page tp ON tp.ticket_id = fi.ticket_id
  CROSS JOIN ticket_totals tt
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', w.id,
        'category_type_id', w.category_type_id,
        'task_type_id', w.task_type_id,
        'tailor_id', w.tailor_id,
        'status', w.status,
        'pay_amount', w.pay_amount,
        'rate_snapshot', w.rate_snapshot,
        'pay_source', w.pay_source,
        'price_review_requested', w.price_review_requested,
        'price_review_reason', w.price_review_reason,
        'price_review_requested_at', w.price_review_requested_at,
        'price_review_resolved_at', w.price_review_resolved_at,
        'negotiated_pay_amount', w.negotiated_pay_amount,
        'negotiated_price_note', w.negotiated_price_note,
        'negotiated_price_set_at', w.negotiated_price_set_at,
        'category_types', jsonb_build_object('name', ct.name),
        'task_types', jsonb_build_object('name', tt2.name),
        'tailors', jsonb_build_object('name', tr.name, 'active', tr.active, 'band', tr.band)
      )
      ORDER BY w.created_at DESC
    ) AS assignments
    FROM public.work_assignments w
    LEFT JOIN public.category_types ct ON ct.id = w.category_type_id
    LEFT JOIN public.task_types tt2 ON tt2.id = w.task_type_id
    LEFT JOIN public.tailors tr ON tr.id = w.tailor_id
    WHERE w.item_id = fi.id
      AND w.organization_id = public.current_org_id()
  ) wa ON true
  ORDER BY fi.created_at DESC, fi.item_key ASC;
$$;

REVOKE ALL ON FUNCTION public.get_ticket_paginated_items(text, text, text, text, text, timestamptz, timestamptz, text, boolean, boolean, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ticket_paginated_items(text, text, text, text, text, timestamptz, timestamptz, text, boolean, boolean, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_account_tailor_paginated_tasks(
  p_filter text DEFAULT 'pending',
  p_customer_search text DEFAULT NULL,
  p_ticket_search text DEFAULT NULL,
  p_tailor_search text DEFAULT NULL,
  p_task_name text DEFAULT NULL,
  p_category_name text DEFAULT NULL,
  p_min_amount numeric DEFAULT NULL,
  p_max_amount numeric DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS TABLE (
  task jsonb,
  total_tailors bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered_tasks AS (
    SELECT
      wa.*,
      tt.name AS task_type_name,
      ct.name AS category_name,
      tr.name AS tailor_name,
      i.item_key,
      tk.customer_name,
      tk.ticket_number,
      COALESCE(wa.tailor_id::text, '__unassigned__') AS tailor_group_key,
      COALESCE(tr.name, 'Unassigned') AS tailor_group_name
    FROM public.work_assignments wa
    LEFT JOIN public.task_types tt ON tt.id = wa.task_type_id
    LEFT JOIN public.category_types ct ON ct.id = wa.category_type_id
    LEFT JOIN public.tailors tr ON tr.id = wa.tailor_id
    LEFT JOIN public.items i ON i.id = wa.item_id
    LEFT JOIN public.tickets tk ON tk.id = i.ticket_id
    WHERE wa.organization_id = public.current_org_id()
      AND (
        COALESCE(p_filter, 'all') = 'all'
        OR (p_filter = 'pending' AND wa.status::text = 'CREATED')
        OR (p_filter = 'price-review' AND wa.status::text = 'CREATED' AND wa.price_review_requested = true)
        OR (p_filter = 'approved' AND wa.status::text IN ('QC_PASSED', 'PAID'))
        OR (p_filter = 'rejected' AND wa.status::text = 'QC_FAILED')
        OR (
          p_filter = 'reversed'
          AND (
            wa.status::text = 'REVERSED'
            OR wa.reversal_reason IS NOT NULL
          )
        )
      )
      AND (p_customer_search IS NULL OR tk.customer_name ILIKE '%' || p_customer_search || '%')
      AND (
        p_ticket_search IS NULL
        OR i.item_key ILIKE '%' || p_ticket_search || '%'
        OR tk.ticket_number ILIKE '%' || p_ticket_search || '%'
      )
      AND (p_tailor_search IS NULL OR COALESCE(tr.name, 'Unassigned') ILIKE '%' || p_tailor_search || '%')
      AND (p_task_name IS NULL OR tt.name = p_task_name)
      AND (p_category_name IS NULL OR ct.name = p_category_name)
      AND (p_min_amount IS NULL OR wa.pay_amount >= p_min_amount)
      AND (p_max_amount IS NULL OR wa.pay_amount <= p_max_amount)
      AND (p_start_date IS NULL OR wa.created_at >= p_start_date)
      AND (p_end_date IS NULL OR wa.created_at <= p_end_date)
  ),
  tailor_groups AS (
    SELECT
      tailor_group_key,
      MIN(tailor_group_name) AS tailor_group_name,
      MAX(created_at) AS latest_task_at
    FROM filtered_tasks
    GROUP BY tailor_group_key
  ),
  tailor_totals AS (
    SELECT COUNT(*)::bigint AS total_tailors
    FROM tailor_groups
  ),
  tailor_page AS (
    SELECT tailor_group_key
    FROM tailor_groups
    ORDER BY tailor_group_name ASC, latest_task_at DESC, tailor_group_key ASC
    LIMIT GREATEST(1, p_page_size)
    OFFSET GREATEST(0, (GREATEST(1, p_page) - 1) * GREATEST(1, p_page_size))
  )
  SELECT
    to_jsonb(ft) AS task,
    totals.total_tailors
  FROM filtered_tasks ft
  JOIN tailor_page tp ON tp.tailor_group_key = ft.tailor_group_key
  CROSS JOIN tailor_totals totals
  ORDER BY ft.tailor_group_name ASC, ft.created_at DESC, ft.item_key ASC;
$$;

REVOKE ALL ON FUNCTION public.get_account_tailor_paginated_tasks(text, text, text, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_account_tailor_paginated_tasks(text, text, text, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, integer) TO authenticated;
