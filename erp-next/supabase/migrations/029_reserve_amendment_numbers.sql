-- Reserve an amendment number when a request is submitted, not when approved.
-- Rejected requests retain their number so references never change or get reused.

ALTER TABLE public.work_change_requests
ADD COLUMN amendment_ordinal integer CHECK (amendment_ordinal >= 0);

UPDATE public.work_change_requests r
SET amendment_ordinal = ao.ordinal
FROM public.amendment_occurrences ao
WHERE ao.request_id = r.id AND r.kind = 'AMENDMENT';

DO $$
DECLARE
  v_request record;
  v_last integer;
BEGIN
  FOR v_request IN
    SELECT id, item_id, organization_id
    FROM public.work_change_requests
    WHERE kind = 'AMENDMENT' AND amendment_ordinal IS NULL
    ORDER BY organization_id, item_id, created_at, id
  LOOP
    SELECT GREATEST(
      COALESCE((SELECT MAX(amendment_ordinal) FROM public.work_change_requests
        WHERE item_id = v_request.item_id AND organization_id = v_request.organization_id), -1),
      COALESCE((SELECT MAX(ordinal) FROM public.amendment_occurrences
        WHERE item_id = v_request.item_id AND organization_id = v_request.organization_id), -1),
      CASE WHEN EXISTS (
        SELECT 1 FROM public.work_assignments wa
        JOIN public.category_types ct ON ct.id = wa.category_type_id
        WHERE wa.item_id = v_request.item_id AND wa.organization_id = v_request.organization_id
          AND wa.amendment_occurrence_id IS NULL AND lower(ct.name) = 'amendment'
      ) THEN 0 ELSE -1 END
    ) INTO v_last;

    UPDATE public.work_change_requests
    SET amendment_ordinal = v_last + 1
    WHERE id = v_request.id;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX work_change_requests_amendment_number_unique
ON public.work_change_requests (organization_id, item_id, amendment_ordinal)
WHERE amendment_ordinal IS NOT NULL;

CREATE TABLE public.amendment_number_counters (
  item_id uuid PRIMARY KEY REFERENCES public.items(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  next_ordinal integer NOT NULL CHECK (next_ordinal > 0)
);

REVOKE ALL ON public.amendment_number_counters FROM anon, authenticated;
ALTER TABLE public.amendment_number_counters ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.reserve_amendment_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last integer;
  v_ordinal integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.amendment_ordinal IS DISTINCT FROM OLD.amendment_ordinal THEN
      RAISE EXCEPTION 'Amendment number cannot be changed';
    END IF;
    IF NEW.item_id IS DISTINCT FROM OLD.item_id THEN
      RAISE EXCEPTION 'Request garment cannot be changed';
    END IF;
  END IF;

  IF NEW.kind <> 'AMENDMENT' OR NEW.amendment_ordinal IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.items
  WHERE id = NEW.item_id AND organization_id = NEW.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Garment not found'; END IF;

  SELECT GREATEST(
    COALESCE((SELECT MAX(amendment_ordinal) FROM public.work_change_requests
      WHERE item_id = NEW.item_id AND organization_id = NEW.organization_id), -1),
    COALESCE((SELECT MAX(ordinal) FROM public.amendment_occurrences
      WHERE item_id = NEW.item_id AND organization_id = NEW.organization_id), -1),
    CASE WHEN EXISTS (
      SELECT 1 FROM public.work_assignments wa
      JOIN public.category_types ct ON ct.id = wa.category_type_id
      WHERE wa.item_id = NEW.item_id AND wa.organization_id = NEW.organization_id
        AND wa.amendment_occurrence_id IS NULL AND lower(ct.name) = 'amendment'
    ) THEN 0 ELSE -1 END
  ) INTO v_last;

  INSERT INTO public.amendment_number_counters (item_id, organization_id, next_ordinal)
  VALUES (NEW.item_id, NEW.organization_id, v_last + 2)
  ON CONFLICT (item_id) DO UPDATE
    SET next_ordinal = GREATEST(
      public.amendment_number_counters.next_ordinal + 1,
      EXCLUDED.next_ordinal
    )
  RETURNING next_ordinal - 1 INTO v_ordinal;

  NEW.amendment_ordinal := v_ordinal;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reserve_amendment_number
BEFORE INSERT OR UPDATE OF kind, item_id, amendment_ordinal
ON public.work_change_requests
FOR EACH ROW EXECUTE FUNCTION public.reserve_amendment_number();

CREATE FUNCTION public.use_reserved_amendment_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ordinal integer;
BEGIN
  SELECT r.amendment_ordinal INTO v_ordinal
  FROM public.work_change_requests r
  WHERE r.id = NEW.request_id
    AND r.organization_id = NEW.organization_id
    AND r.item_id = NEW.item_id
    AND r.kind = 'AMENDMENT';

  IF v_ordinal IS NULL THEN
    RAISE EXCEPTION 'Amendment request has no reserved number';
  END IF;
  NEW.ordinal := v_ordinal;
  RETURN NEW;
END;
$$;

CREATE TRIGGER use_reserved_amendment_number
BEFORE INSERT ON public.amendment_occurrences
FOR EACH ROW EXECUTE FUNCTION public.use_reserved_amendment_number();
