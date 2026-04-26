-- Migration 008: Aggregate monthly payroll totals in Postgres.

CREATE OR REPLACE FUNCTION public.get_monthly_payroll_summary()
RETURNS TABLE (
  month_key text,
  tailor_id uuid,
  tailor_name text,
  department text,
  monthly_total_pay numeric,
  task_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    TO_CHAR(wa.updated_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM') AS month_key,
    wa.tailor_id,
    COALESCE(t.name, 'Unknown') AS tailor_name,
    COALESCE(t.department, 'Production') AS department,
    COALESCE(SUM(wa.pay_amount), 0)::numeric AS monthly_total_pay,
    COUNT(*)::bigint AS task_count
  FROM public.work_assignments wa
  LEFT JOIN public.tailors t ON t.id = wa.tailor_id
  WHERE wa.organization_id = public.current_org_id()
    AND wa.status IN ('QC_PASSED', 'PAID')
  GROUP BY month_key, wa.tailor_id, t.name, t.department
  ORDER BY month_key ASC, monthly_total_pay DESC, tailor_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_monthly_payroll_summary() TO authenticated;
