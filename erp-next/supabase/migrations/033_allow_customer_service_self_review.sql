-- Customer Service and Admin may review their own work-change requests.
-- Request status, version, organization, and review history checks remain in place.

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
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT (
    public.has_permission('manage_customer_service') OR public.has_permission('admin')
  ) THEN
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

CREATE OR REPLACE FUNCTION public.approve_work_change_request(
  p_request_id uuid,
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
  v_original public.items%ROWTYPE;
  v_target_item_id uuid;
  v_occurrence_id uuid;
  v_ordinal integer;
  v_entry jsonb;
  v_category_id uuid;
  v_task_id uuid;
  v_tailor_id uuid;
  v_pay record;
  v_pay_source text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT (
    public.has_permission('manage_customer_service') OR public.has_permission('admin')
  ) THEN
    RAISE EXCEPTION 'Customer Service permission required';
  END IF;

  SELECT * INTO v_original
  FROM public.items
  WHERE id = (
    SELECT item_id FROM public.work_change_requests
    WHERE id = p_request_id AND organization_id = v_org_id
  ) AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_original.status::text IN ('ARCHIVED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Garment is no longer eligible';
  END IF;

  SELECT * INTO v_request
  FROM public.work_change_requests
  WHERE id = p_request_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Pending request not found';
  END IF;

  IF p_expected_version IS DISTINCT FROM v_request.version THEN
    RAISE EXCEPTION 'Request changed since it was opened. Refresh and try again';
  END IF;

  IF v_request.kind = 'AMENDMENT' THEN
    SELECT GREATEST(
      COALESCE(MAX(ao.ordinal), -1),
      CASE WHEN EXISTS (
        SELECT 1 FROM public.work_assignments wa
        JOIN public.category_types ct ON ct.id = wa.category_type_id
        WHERE wa.item_id = v_original.id
          AND wa.organization_id = v_org_id
          AND wa.amendment_occurrence_id IS NULL
          AND lower(ct.name) = 'amendment'
      ) THEN 0 ELSE -1 END
    ) + 1 INTO v_ordinal
    FROM public.amendment_occurrences ao
    WHERE ao.item_id = v_original.id AND ao.organization_id = v_org_id;

    INSERT INTO public.amendment_occurrences (
      organization_id, item_id, request_id, ordinal
    ) VALUES (
      v_org_id, v_original.id, v_request.id, v_ordinal
    ) RETURNING id INTO v_occurrence_id;

    v_target_item_id := v_original.id;
  ELSE
    INSERT INTO public.items (
      organization_id, ticket_id, product_type_id, status,
      replacement_of_item_id, approved_work_change_request_id
    ) VALUES (
      v_org_id, v_original.ticket_id, v_original.product_type_id,
      'IN_PRODUCTION', v_original.id, v_request.id
    ) RETURNING id INTO v_target_item_id;

    INSERT INTO public.custom_field_values (
      organization_id, item_id, field_id, text_value, number_value,
      boolean_value, date_value, option_value
    )
    SELECT organization_id, v_target_item_id, field_id, text_value,
           number_value, boolean_value, date_value, option_value
    FROM public.custom_field_values
    WHERE organization_id = v_org_id AND item_id = v_original.id;
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_request.proposed_assignments)
  LOOP
    v_category_id := (v_entry->>'category_type_id')::uuid;
    v_task_id := (v_entry->>'task_type_id')::uuid;
    v_tailor_id := (v_entry->>'tailor_id')::uuid;

    IF NOT EXISTS (
      SELECT 1 FROM public.rate_cards rc
      JOIN public.category_types ct ON ct.id = rc.category_type_id
        AND ct.organization_id = rc.organization_id
      JOIN public.tailors t ON t.id = v_tailor_id
        AND t.organization_id = rc.organization_id AND t.active = true
      WHERE rc.organization_id = v_org_id
        AND rc.product_type_id = v_original.product_type_id
        AND rc.category_type_id = v_category_id
        AND rc.task_type_id = v_task_id
        AND rc.active = true
        AND (v_request.kind = 'REPLACEMENT' OR lower(ct.name) = 'amendment')
    ) THEN
      RAISE EXCEPTION 'Proposed task or tailor is no longer available';
    END IF;

    SELECT * INTO v_pay FROM public.calculate_assignment_pay(
      v_target_item_id, v_category_id, v_task_id, v_tailor_id
    );
    v_pay_source := CASE WHEN v_pay.special_fee IS NOT NULL THEN 'SPECIAL_PAY' ELSE 'RATE_CARD' END;

    INSERT INTO public.work_assignments (
      organization_id, item_id, category_type_id, task_type_id,
      tailor_id, amendment_occurrence_id, status, pay_band_snapshot,
      rate_snapshot, pay_amount, pay_source
    ) VALUES (
      v_org_id, v_target_item_id, v_category_id, v_task_id,
      v_tailor_id, v_occurrence_id, 'CREATED', v_pay.pay_band,
      v_pay.base_fee, v_pay.final_fee, v_pay_source
    );
  END LOOP;

  UPDATE public.work_change_requests
  SET status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(),
      updated_by = auth.uid(), version = version + 1, updated_at = now(),
      approved_snapshot = jsonb_build_object(
        'kind', kind, 'note', note,
        'proposed_assignments', proposed_assignments,
        'target_item_id', v_target_item_id,
        'amendment_occurrence_id', v_occurrence_id
      )
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  INSERT INTO public.work_change_request_revisions (
    request_id, organization_id, version, actor_user_id, action,
    before_state, after_state
  ) VALUES (
    v_request.id, v_org_id, v_request.version, auth.uid(), 'APPROVED',
    jsonb_build_object('status', 'PENDING'),
    v_request.approved_snapshot
  );

  RETURN v_target_item_id;
END;
$$;
