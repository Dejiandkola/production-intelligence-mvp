-- Pending Amendment and Replacement requests. This migration does not activate
-- work or create replacement items; approval will follow in a later migration.

CREATE TABLE public.work_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('AMENDMENT', 'REPLACEMENT')),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
  proposed_assignments jsonb NOT NULL CHECK (
    jsonb_typeof(proposed_assignments) = 'array'
    AND jsonb_array_length(proposed_assignments) BETWEEN 1 AND 20
  ),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  reviewed_by uuid REFERENCES auth.users(id),
  review_reason text,
  reviewed_at timestamptz,
  approved_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_change_requests_org_status_idx
ON public.work_change_requests (organization_id, status, created_at DESC);

CREATE INDEX work_change_requests_item_idx
ON public.work_change_requests (organization_id, item_id, created_at DESC);

CREATE TABLE public.work_change_request_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.work_change_requests(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version integer NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL CHECK (action IN ('SUBMITTED', 'EDITED', 'REJECTED', 'APPROVED')),
  before_state jsonb,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, version)
);

ALTER TABLE public.work_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_change_request_revisions ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.work_change_requests FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.work_change_request_revisions FROM anon, authenticated;
GRANT SELECT ON public.work_change_requests TO authenticated;
GRANT SELECT ON public.work_change_request_revisions TO authenticated;

CREATE POLICY work_change_requests_read ON public.work_change_requests
FOR SELECT TO authenticated
USING (
  organization_id = public.current_org_id()
  AND (
    created_by = auth.uid()
    OR public.has_permission('manage_customer_service')
    OR public.has_permission('admin')
    OR (status = 'PENDING' AND public.has_permission('submit_work_requests'))
  )
);

CREATE POLICY work_change_request_revisions_read ON public.work_change_request_revisions
FOR SELECT TO authenticated
USING (
  organization_id = public.current_org_id()
  AND EXISTS (
    SELECT 1 FROM public.work_change_requests wcr
    WHERE wcr.id = public.work_change_request_revisions.request_id
      AND wcr.organization_id = public.work_change_request_revisions.organization_id
  )
);

CREATE OR REPLACE FUNCTION public.save_work_change_request(
  p_request_id uuid,
  p_item_id uuid,
  p_kind text,
  p_note text,
  p_assignments jsonb,
  p_expected_version integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_request public.work_change_requests%ROWTYPE;
  v_item_status text;
  v_product_type_id uuid;
  v_entry jsonb;
  v_category_id uuid;
  v_task_id uuid;
  v_tailor_id uuid;
  v_normalized jsonb := '[]'::jsonb;
  v_before jsonb;
  v_action text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT (
    public.has_permission('submit_work_requests')
    OR public.has_permission('manage_customer_service')
  ) THEN
    RAISE EXCEPTION 'Request permission required';
  END IF;

  IF p_kind NOT IN ('AMENDMENT', 'REPLACEMENT') OR p_kind IS NULL THEN
    RAISE EXCEPTION 'Invalid request type';
  END IF;

  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A short note is required';
  END IF;

  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Select between 1 and 20 tasks';
  END IF;

  IF jsonb_array_length(p_assignments) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Select between 1 and 20 tasks';
  END IF;

  SELECT i.status::text, i.product_type_id
  INTO v_item_status, v_product_type_id
  FROM public.items i
  WHERE i.id = p_item_id AND i.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Garment not found';
  END IF;

  IF v_item_status IN ('ARCHIVED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Archived or cancelled garments cannot receive requests';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_assignments)
  LOOP
    IF jsonb_typeof(v_entry) <> 'object' THEN
      RAISE EXCEPTION 'Invalid task proposal';
    END IF;

    v_category_id := (v_entry->>'category_type_id')::uuid;
    v_task_id := (v_entry->>'task_type_id')::uuid;
    v_tailor_id := (v_entry->>'tailor_id')::uuid;

    IF v_category_id IS NULL OR v_task_id IS NULL OR v_tailor_id IS NULL THEN
      RAISE EXCEPTION 'Category, task, and tailor are required';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.rate_cards rc
      JOIN public.category_types ct ON ct.id = rc.category_type_id
        AND ct.organization_id = rc.organization_id
      JOIN public.task_types tt ON tt.id = rc.task_type_id
        AND tt.organization_id = rc.organization_id
      JOIN public.tailors t ON t.id = v_tailor_id
        AND t.organization_id = rc.organization_id AND t.active = true
      WHERE rc.organization_id = v_org_id
        AND rc.product_type_id = v_product_type_id
        AND rc.category_type_id = v_category_id
        AND rc.task_type_id = v_task_id
        AND rc.active = true
        AND (p_kind = 'REPLACEMENT' OR lower(ct.name) = 'amendment')
    ) THEN
      RAISE EXCEPTION 'Task or tailor is not available for this garment';
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_normalized) AS prior(value)
      WHERE prior.value->>'category_type_id' = v_category_id::text
        AND prior.value->>'task_type_id' = v_task_id::text
    ) THEN
      RAISE EXCEPTION 'A task type can only appear once in this request';
    END IF;

    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'category_type_id', v_category_id,
      'task_type_id', v_task_id,
      'tailor_id', v_tailor_id
    ));
  END LOOP;

  IF p_request_id IS NULL THEN
    INSERT INTO public.work_change_requests (
      organization_id, item_id, kind, note, proposed_assignments,
      created_by, updated_by
    ) VALUES (
      v_org_id, p_item_id, p_kind, btrim(p_note), v_normalized,
      auth.uid(), auth.uid()
    ) RETURNING * INTO v_request;
    v_action := 'SUBMITTED';
  ELSE
    SELECT * INTO v_request
    FROM public.work_change_requests
    WHERE id = p_request_id AND organization_id = v_org_id
    FOR UPDATE;

    IF NOT FOUND OR v_request.status <> 'PENDING' THEN
      RAISE EXCEPTION 'Pending request not found';
    END IF;

    IF v_request.item_id <> p_item_id THEN
      RAISE EXCEPTION 'The garment cannot be changed on a pending request';
    END IF;

    IF v_request.created_by <> auth.uid()
       AND NOT public.has_permission('manage_customer_service')
       AND NOT public.has_permission('admin') THEN
      RAISE EXCEPTION 'Only the requester or Customer Service can edit this request';
    END IF;

    IF p_expected_version IS DISTINCT FROM v_request.version THEN
      RAISE EXCEPTION 'Request changed since it was opened. Refresh and try again';
    END IF;

    v_before := jsonb_build_object(
      'kind', v_request.kind,
      'note', v_request.note,
      'proposed_assignments', v_request.proposed_assignments
    );

    UPDATE public.work_change_requests
    SET kind = p_kind, note = btrim(p_note), proposed_assignments = v_normalized,
        updated_by = auth.uid(), version = version + 1, updated_at = now()
    WHERE id = p_request_id
    RETURNING * INTO v_request;
    v_action := 'EDITED';
  END IF;

  INSERT INTO public.work_change_request_revisions (
    request_id, organization_id, version, actor_user_id, action,
    before_state, after_state
  ) VALUES (
    v_request.id, v_org_id, v_request.version, auth.uid(), v_action,
    v_before,
    jsonb_build_object(
      'kind', v_request.kind,
      'note', v_request.note,
      'proposed_assignments', v_request.proposed_assignments
    )
  );

  RETURN v_request.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_work_change_request(
  p_request_id uuid,
  p_expected_version integer,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_request public.work_change_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT public.has_permission('manage_customer_service') THEN
    RAISE EXCEPTION 'Customer Service permission required';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  SELECT * INTO v_request
  FROM public.work_change_requests
  WHERE id = p_request_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Pending request not found';
  END IF;

  IF v_request.created_by = auth.uid() THEN
    RAISE EXCEPTION 'The requester cannot review their own request';
  END IF;

  IF p_expected_version IS DISTINCT FROM v_request.version THEN
    RAISE EXCEPTION 'Request changed since it was opened. Refresh and try again';
  END IF;

  UPDATE public.work_change_requests
  SET status = 'REJECTED', review_reason = btrim(p_reason),
      reviewed_by = auth.uid(), reviewed_at = now(),
      updated_by = auth.uid(), version = version + 1, updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  INSERT INTO public.work_change_request_revisions (
    request_id, organization_id, version, actor_user_id, action,
    before_state, after_state
  ) VALUES (
    v_request.id, v_org_id, v_request.version, auth.uid(), 'REJECTED',
    jsonb_build_object('status', 'PENDING'),
    jsonb_build_object('status', 'REJECTED', 'reason', v_request.review_reason)
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.save_work_change_request(uuid, uuid, text, text, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_work_change_request(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_work_change_request(uuid, uuid, text, text, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_work_change_request(uuid, integer, text) TO authenticated;
