-- Migration 011: Return account task rows paginated by complete tailor groups.

CREATE OR REPLACE FUNCTION public.get_account_tailor_paginated_tasks(
  p_filter text DEFAULT 'pending',
  p_customer_search text DEFAULT NULL,
  p_ticket_search text DEFAULT NULL,
  p_tailor_search text DEFAULT NULL,
  p_task_name text DEFAULT NULL,
  p_category_name text DEFAULT NULL,
  p_min_amount numeric DEFAULT NULL,
  p_max_amount numeric DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS TABLE (
  task jsonb,
  total_tailors bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered_tasks AS (
    SELECT
      wa.*,
      tt.name AS task_type_name,
      ct.name AS category_name,
      tr.name AS tailor_name,
      i.item_key,
      tk.customer_name,
      tk.ticket_number,
      COALESCE(wa.tailor_id::text, '__unassigned__') AS tailor_group_key,
      COALESCE(tr.name, 'Unassigned') AS tailor_group_name
    FROM public.work_assignments wa
    LEFT JOIN public.task_types tt ON tt.id = wa.task_type_id
    LEFT JOIN public.category_types ct ON ct.id = wa.category_type_id
    LEFT JOIN public.tailors tr ON tr.id = wa.tailor_id
    LEFT JOIN public.items i ON i.id = wa.item_id
    LEFT JOIN public.tickets tk ON tk.id = i.ticket_id
    WHERE wa.organization_id = public.current_org_id()
      AND (
        COALESCE(p_filter, 'all') = 'all'
        OR (p_filter = 'pending' AND wa.status::text = 'CREATED')
        OR (p_filter = 'approved' AND wa.status::text IN ('QC_PASSED', 'PAID'))
        OR (p_filter = 'rejected' AND wa.status::text = 'QC_FAILED')
        OR (
          p_filter = 'reversed'
          AND (
            wa.status::text = 'REVERSED'
            OR wa.reversal_reason IS NOT NULL
          )
        )
      )
      AND (p_customer_search IS NULL OR tk.customer_name ILIKE '%' || p_customer_search || '%')
      AND (
        p_ticket_search IS NULL
        OR i.item_key ILIKE '%' || p_ticket_search || '%'
        OR tk.ticket_number ILIKE '%' || p_ticket_search || '%'
      )
      AND (p_tailor_search IS NULL OR COALESCE(tr.name, 'Unassigned') ILIKE '%' || p_tailor_search || '%')
      AND (p_task_name IS NULL OR tt.name = p_task_name)
      AND (p_category_name IS NULL OR ct.name = p_category_name)
      AND (p_min_amount IS NULL OR wa.pay_amount >= p_min_amount)
      AND (p_max_amount IS NULL OR wa.pay_amount <= p_max_amount)
      AND (p_start_date IS NULL OR wa.created_at >= p_start_date)
      AND (p_end_date IS NULL OR wa.created_at <= p_end_date)
  ),
  tailor_groups AS (
    SELECT
      tailor_group_key,
      MIN(tailor_group_name) AS tailor_group_name,
      MAX(created_at) AS latest_task_at
    FROM filtered_tasks
    GROUP BY tailor_group_key
  ),
  tailor_totals AS (
    SELECT COUNT(*)::bigint AS total_tailors
    FROM tailor_groups
  ),
  tailor_page AS (
    SELECT tailor_group_key
    FROM tailor_groups
    ORDER BY tailor_group_name ASC, latest_task_at DESC, tailor_group_key ASC
    LIMIT GREATEST(1, p_page_size)
    OFFSET GREATEST(0, (GREATEST(1, p_page) - 1) * GREATEST(1, p_page_size))
  )
  SELECT
    to_jsonb(ft) AS task,
    totals.total_tailors
  FROM filtered_tasks ft
  JOIN tailor_page tp ON tp.tailor_group_key = ft.tailor_group_key
  CROSS JOIN tailor_totals totals
  ORDER BY ft.tailor_group_name ASC, ft.created_at DESC, ft.item_key ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_account_tailor_paginated_tasks(text, text, text, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, integer) TO authenticated;
