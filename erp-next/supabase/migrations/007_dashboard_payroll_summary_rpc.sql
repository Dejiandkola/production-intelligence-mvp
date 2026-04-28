-- Migration 007: Aggregate dashboard payroll totals in Postgres.

CREATE OR REPLACE FUNCTION public.get_dashboard_payroll_summary(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS TABLE (
  tailor_id uuid,
  tailor_name text,
  department text,
  weekly_verified_total numeric,
  weekly_total_pay numeric,
  task_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    wa.tailor_id,
    COALESCE(t.name, 'Unknown') AS tailor_name,
    COALESCE(t.department, 'Production') AS department,
    COALESCE(SUM(wa.pay_amount), 0)::numeric AS weekly_verified_total,
    COALESCE(SUM(wa.pay_amount), 0)::numeric AS weekly_total_pay,
    COUNT(*)::bigint AS task_count
  FROM public.work_assignments wa
  LEFT JOIN public.tailors t ON t.id = wa.tailor_id
  WHERE wa.organization_id = public.current_org_id()
    AND wa.status IN ('QC_PASSED', 'PAID')
    AND wa.updated_at >= p_start_date
    AND wa.updated_at <= p_end_date
  GROUP BY wa.tailor_id, t.name, t.department
  ORDER BY weekly_total_pay DESC, tailor_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_payroll_summary(timestamptz, timestamptz) TO authenticated;
