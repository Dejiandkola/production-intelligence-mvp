-- Migration 016: Tailor-specific fixed special fees.
--
-- A tailor can earn an exact fee for a task type. When a matching rule exists,
-- assignment creation/editing uses that fee instead of the normal band rate.

CREATE TABLE IF NOT EXISTS public.tailor_special_pay (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tailor_id uuid NOT NULL REFERENCES public.tailors(id) ON DELETE CASCADE,
  task_type_id uuid NOT NULL REFERENCES public.task_types(id) ON DELETE CASCADE,
  special_fee numeric(12,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.tailor_special_pay
ADD COLUMN IF NOT EXISTS special_fee numeric(12,2);

ALTER TABLE public.tailor_special_pay
ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE public.tailor_special_pay
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tailor_special_pay_special_fee_nonnegative'
      AND conrelid = 'public.tailor_special_pay'::regclass
  ) THEN
    ALTER TABLE public.tailor_special_pay
    ADD CONSTRAINT tailor_special_pay_special_fee_nonnegative
    CHECK (special_fee IS NULL OR special_fee >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tailor_special_pay_org_tailor_task_key'
      AND conrelid = 'public.tailor_special_pay'::regclass
  ) THEN
    ALTER TABLE public.tailor_special_pay
    ADD CONSTRAINT tailor_special_pay_org_tailor_task_key
    UNIQUE (organization_id, tailor_id, task_type_id);
  END IF;
END $$;

ALTER TABLE public.tailor_special_pay ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tailor_special_pay_select_org" ON public.tailor_special_pay;
DROP POLICY IF EXISTS "tailor_special_pay_manage_tailors" ON public.tailor_special_pay;

CREATE POLICY "tailor_special_pay_select_org"
ON public.tailor_special_pay
FOR SELECT
USING (organization_id = public.current_org_id());

CREATE POLICY "tailor_special_pay_manage_tailors"
ON public.tailor_special_pay
FOR ALL
USING (
  organization_id = public.current_org_id()
  AND public.has_permission('manage_tailors')
)
WITH CHECK (
  organization_id = public.current_org_id()
  AND public.has_permission('manage_tailors')
);

DROP TRIGGER IF EXISTS set_updated_at_tailor_special_pay ON public.tailor_special_pay;
CREATE TRIGGER set_updated_at_tailor_special_pay
BEFORE UPDATE ON public.tailor_special_pay
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS audit_tailor_special_pay ON public.tailor_special_pay;
CREATE TRIGGER audit_tailor_special_pay
AFTER INSERT OR UPDATE OR DELETE ON public.tailor_special_pay
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE OR REPLACE FUNCTION public.calculate_assignment_pay(
  p_item_id uuid,
  p_category_type_id uuid,
  p_task_type_id uuid,
  p_tailor_id uuid
)
RETURNS TABLE (
  pay_band tailor_band,
  base_fee numeric,
  special_fee numeric,
  final_fee numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_product_type_id uuid;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization context not found';
  END IF;

  SELECT i.product_type_id
  INTO v_product_type_id
  FROM public.items i
  WHERE i.id = p_item_id
    AND i.organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  SELECT t.band
  INTO pay_band
  FROM public.tailors t
  WHERE t.id = p_tailor_id
    AND t.organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tailor not found';
  END IF;

  SELECT
    CASE
      WHEN pay_band = 'B' THEN rc.band_b_fee
      ELSE rc.band_a_fee
    END
  INTO base_fee
  FROM public.rate_cards rc
  WHERE rc.organization_id = v_org_id
    AND rc.product_type_id = v_product_type_id
    AND rc.category_type_id = p_category_type_id
    AND rc.task_type_id = p_task_type_id;

  IF base_fee IS NULL THEN
    RAISE EXCEPTION 'Rate card not found for this task and product';
  END IF;

  SELECT tsp.special_fee
  INTO special_fee
  FROM public.tailor_special_pay tsp
  WHERE tsp.organization_id = v_org_id
    AND tsp.tailor_id = p_tailor_id
    AND tsp.task_type_id = p_task_type_id
    AND tsp.special_fee IS NOT NULL;

  final_fee := COALESCE(special_fee, base_fee);

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_assignment_pay(uuid, uuid, uuid, uuid) TO authenticated;

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
    ) AND OLD.status::text <> 'CREATED' THEN
      RAISE EXCEPTION 'Snapshot fields are immutable after work assignment progresses';
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

  INSERT INTO public.work_assignments (
    organization_id, item_id, category_type_id, task_type_id,
    tailor_id, status, pay_band_snapshot, rate_snapshot, pay_amount
  ) VALUES (
    v_org_id, p_item_id, p_category_type_id, p_task_type_id,
    p_tailor_id, 'CREATED', v_pay.pay_band, v_pay.base_fee, v_pay.final_fee
  )
  ON CONFLICT (organization_id, item_id, category_type_id, task_type_id)
  DO UPDATE SET
    tailor_id = EXCLUDED.tailor_id,
    pay_band_snapshot = EXCLUDED.pay_band_snapshot,
    rate_snapshot = EXCLUDED.rate_snapshot,
    pay_amount = EXCLUDED.pay_amount
  RETURNING id INTO v_assignment_id;

  IF v_item_status = 'NEW' THEN
    UPDATE public.items
    SET status = 'IN_PRODUCTION'
    WHERE id = p_item_id AND organization_id = v_org_id;
  END IF;

  RETURN v_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_work_assignment(uuid, uuid, uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.update_work_assignment(uuid, uuid, uuid, uuid);

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

  UPDATE public.work_assignments
  SET
    category_type_id = p_category_type_id,
    task_type_id = p_task_type_id,
    tailor_id = p_tailor_id,
    pay_band_snapshot = v_pay.pay_band,
    rate_snapshot = v_pay.base_fee,
    pay_amount = v_pay.final_fee
  WHERE id = p_assignment_id
    AND organization_id = v_org_id;

  RETURN p_assignment_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_work_assignment(uuid, uuid, uuid, uuid) TO authenticated;