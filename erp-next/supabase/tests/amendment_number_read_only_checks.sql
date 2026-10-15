-- Run after migration 030. Read-only; does not submit or approve requests.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.work_change_requests
    WHERE kind = 'AMENDMENT' AND status = 'APPROVED' AND amendment_ordinal IS NULL
  ) THEN RAISE EXCEPTION 'An approved amendment request has no number'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.work_change_requests
    WHERE status <> 'APPROVED' AND amendment_ordinal IS NOT NULL
  ) THEN RAISE EXCEPTION 'A pending or rejected request has a permanent number'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.amendment_occurrences ao
    JOIN public.work_change_requests r ON r.id = ao.request_id
    WHERE ao.ordinal IS DISTINCT FROM r.amendment_ordinal
  ) THEN RAISE EXCEPTION 'An approved amendment number differs from its request'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'work_change_requests_amendment_number_unique'
  ) THEN RAISE EXCEPTION 'Amendment number uniqueness index missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.amendment_occurrences'::regclass
      AND tgname = 'number_approved_amendment' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'Approval-time amendment number trigger missing'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class WHERE oid = to_regclass('public.amendment_number_counters')
  ) THEN
    RAISE EXCEPTION 'Obsolete amendment number counters remain';
  END IF;

  RAISE NOTICE 'Amendment number checks passed';
END;
$$;
