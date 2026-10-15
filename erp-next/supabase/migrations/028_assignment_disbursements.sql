-- QC approval authorizes pay; this separate record confirms disbursement.

CREATE TABLE public.assignment_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL UNIQUE REFERENCES public.work_assignments(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount >= 0),
  payment_reference text NOT NULL CHECK (length(btrim(payment_reference)) BETWEEN 1 AND 200),
  paid_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES auth.users(id)
);

ALTER TABLE public.assignment_disbursements ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.assignment_disbursements FROM anon, authenticated;
GRANT SELECT ON public.assignment_disbursements TO authenticated;
CREATE POLICY assignment_disbursements_read ON public.assignment_disbursements
FOR SELECT TO authenticated USING (organization_id = public.current_org_id()
  AND (public.has_permission('manage_payments') OR public.has_permission('admin')));

CREATE FUNCTION public.record_assignment_disbursement(
  p_assignment_id uuid,
  p_payment_reference text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_assignment public.work_assignments%ROWTYPE;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT (
    public.has_permission('manage_payments') OR public.has_permission('admin')
  ) THEN RAISE EXCEPTION 'Accounts permission required'; END IF;
  IF p_payment_reference IS NULL OR length(btrim(p_payment_reference)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Payment reference is required';
  END IF;

  SELECT * INTO v_assignment FROM public.work_assignments
  WHERE id = p_assignment_id AND organization_id = v_org_id FOR UPDATE;
  IF NOT FOUND OR v_assignment.status::text <> 'QC_PASSED' THEN
    RAISE EXCEPTION 'Only QC-approved tasks can be marked paid';
  END IF;

  INSERT INTO public.assignment_disbursements (
    organization_id, assignment_id, amount, payment_reference, recorded_by
  ) VALUES (
    v_org_id, p_assignment_id, v_assignment.pay_amount, btrim(p_payment_reference), auth.uid()
  ) RETURNING id INTO v_id;

  UPDATE public.work_assignments SET status = 'PAID'
  WHERE id = p_assignment_id AND organization_id = v_org_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_work_assignment_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
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

    IF OLD.status::text = 'PAID' THEN
      RAISE EXCEPTION 'Paid work cannot be changed through this workflow';
    END IF;

    IF NEW.status::text = 'PAID' AND OLD.status::text <> 'PAID' AND (
      OLD.status::text <> 'QC_PASSED' OR NOT EXISTS (
        SELECT 1 FROM public.assignment_disbursements d
        WHERE d.assignment_id = NEW.id AND d.organization_id = NEW.organization_id
          AND d.amount = NEW.pay_amount
      )
    ) THEN RAISE EXCEPTION 'Payment record is required before marking work paid'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.get_tailor_portal_payment_summary(
  p_session_token text,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tailor_id uuid;
  v_org_id uuid;
  v_result jsonb;
BEGIN
  IF p_session_token IS NULL OR length(p_session_token) < 32 THEN
    RETURN jsonb_build_object('error_code', 'SESSION_EXPIRED');
  END IF;
  SELECT tpa.tailor_id, tpa.organization_id INTO v_tailor_id, v_org_id
  FROM public.tailor_portal_sessions s
  JOIN public.tailor_portal_access tpa ON tpa.id = s.access_id
  WHERE s.session_token_hash = encode(digest(p_session_token, 'sha256'), 'hex')
    AND s.expires_at > now() AND tpa.is_active;
  IF v_tailor_id IS NULL THEN RETURN jsonb_build_object('error_code', 'SESSION_EXPIRED'); END IF;

  SELECT jsonb_build_object(
    'paid_amount', COALESCE(sum(wa.pay_amount) FILTER (WHERE wa.status::text = 'PAID'), 0),
    'approved_unpaid_amount', COALESCE(sum(wa.pay_amount) FILTER (WHERE wa.status::text = 'QC_PASSED'), 0),
    'awaiting_qc_amount', COALESCE(sum(wa.pay_amount) FILTER (WHERE wa.status::text = 'CREATED'), 0)
  ) INTO v_result
  FROM public.work_assignments wa
  WHERE wa.tailor_id = v_tailor_id AND wa.organization_id = v_org_id
    AND (p_start_date IS NULL OR wa.created_at >= p_start_date::timestamptz)
    AND (p_end_date IS NULL OR wa.created_at < (p_end_date + 1)::timestamptz);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.record_assignment_disbursement(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tailor_portal_payment_summary(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_assignment_disbursement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tailor_portal_payment_summary(text, date, date) TO anon, authenticated;
