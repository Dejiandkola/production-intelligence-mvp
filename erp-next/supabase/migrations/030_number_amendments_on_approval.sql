-- Pending and rejected requests have no permanent amendment number.
-- Existing approved numbers remain unchanged; new numbers are assigned atomically on approval.

DROP TRIGGER reserve_amendment_number ON public.work_change_requests;
DROP TRIGGER use_reserved_amendment_number ON public.amendment_occurrences;
DROP FUNCTION public.reserve_amendment_number();
DROP FUNCTION public.use_reserved_amendment_number();
DROP TABLE public.amendment_number_counters;

DROP INDEX public.work_change_requests_amendment_number_unique;
UPDATE public.work_change_requests
SET amendment_ordinal = NULL
WHERE status <> 'APPROVED' AND amendment_ordinal IS NOT NULL;

CREATE UNIQUE INDEX work_change_requests_amendment_number_unique
ON public.work_change_requests (organization_id, item_id, amendment_ordinal)
WHERE status = 'APPROVED' AND amendment_ordinal IS NOT NULL;

CREATE FUNCTION public.number_approved_amendment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.work_change_requests r
    WHERE r.id = NEW.request_id AND r.organization_id = NEW.organization_id
      AND r.item_id = NEW.item_id AND r.kind = 'AMENDMENT'
      AND r.status = 'PENDING' AND r.amendment_ordinal IS NULL
  ) THEN
    RAISE EXCEPTION 'Pending amendment request not found';
  END IF;

  -- approve_work_change_request locks the item before inserting an occurrence.
  SELECT GREATEST(
    COALESCE((SELECT MAX(ordinal) FROM public.amendment_occurrences
      WHERE organization_id = NEW.organization_id AND item_id = NEW.item_id), -1),
    CASE WHEN EXISTS (
      SELECT 1 FROM public.work_assignments wa
      JOIN public.category_types ct ON ct.id = wa.category_type_id
      WHERE wa.organization_id = NEW.organization_id AND wa.item_id = NEW.item_id
        AND wa.amendment_occurrence_id IS NULL AND lower(ct.name) = 'amendment'
    ) THEN 0 ELSE -1 END
  ) + 1 INTO v_next;

  NEW.ordinal := v_next;
  UPDATE public.work_change_requests
  SET amendment_ordinal = v_next
  WHERE id = NEW.request_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER number_approved_amendment
BEFORE INSERT ON public.amendment_occurrences
FOR EACH ROW EXECUTE FUNCTION public.number_approved_amendment();
