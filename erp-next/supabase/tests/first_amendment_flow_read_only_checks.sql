-- Run after migration 034. This checks the controls, not mutation paths.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.work_change_requests'::regclass
      AND tgname = 'submit_first_amendment' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'First-amendment submission trigger missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.work_assignments'::regclass
      AND tgname = 'prevent_ordinary_amendment_assignment' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'Ordinary amendment assignment guard missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'work_assignments'
      AND policyname = 'work_assignments_amendment_update_via_function'
  ) THEN RAISE EXCEPTION 'Direct amendment update guard missing'; END IF;

  IF to_regprocedure('public.set_amendment_task_completion(uuid, boolean)') IS NULL THEN
    RAISE EXCEPTION 'Amendment completion function missing';
  END IF;

  IF has_function_privilege('anon', 'public.set_amendment_task_completion(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous clients must not confirm amendment completion';
  END IF;

  RAISE NOTICE 'First-amendment flow checks passed';
END;
$$;
