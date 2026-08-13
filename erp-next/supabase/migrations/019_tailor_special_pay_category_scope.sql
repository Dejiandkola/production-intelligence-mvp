-- Migration 019: Scope tailor special pay by category and task.
--
-- Existing rows are preserved. Rows created before this migration have
-- category_type_id = NULL and will no longer match assignment pay. After the
-- app is deployed and verified, delete those legacy rows separately and
-- recreate the intended special fees through the Tailors UI.

ALTER TABLE public.tailor_special_pay
ADD COLUMN IF NOT EXISTS category_type_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tailor_special_pay_category_type_id_fkey'
      AND conrelid = 'public.tailor_special_pay'::regclass
  ) THEN
    ALTER TABLE public.tailor_special_pay
    ADD CONSTRAINT tailor_special_pay_category_type_id_fkey
    FOREIGN KEY (category_type_id)
    REFERENCES public.category_types(id)
    ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.tailor_special_pay
DROP CONSTRAINT IF EXISTS tailor_special_pay_org_tailor_task_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tailor_special_pay_org_tailor_category_task_key'
      AND conrelid = 'public.tailor_special_pay'::regclass
  ) THEN
    ALTER TABLE public.tailor_special_pay
    ADD CONSTRAINT tailor_special_pay_org_tailor_category_task_key
    UNIQUE (organization_id, tailor_id, category_type_id, task_type_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tailor_special_pay_lookup_idx
ON public.tailor_special_pay (organization_id, tailor_id, category_type_id, task_type_id)
WHERE special_fee IS NOT NULL;

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
    AND tsp.category_type_id = p_category_type_id
    AND tsp.task_type_id = p_task_type_id
    AND tsp.special_fee IS NOT NULL;

  final_fee := COALESCE(special_fee, base_fee);

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_assignment_pay(uuid, uuid, uuid, uuid) TO authenticated;
