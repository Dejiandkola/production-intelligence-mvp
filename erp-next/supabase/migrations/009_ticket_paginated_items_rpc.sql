-- Migration 009: Return filtered item rows paginated by complete ticket groups.

CREATE OR REPLACE FUNCTION public.get_ticket_paginated_items(
  p_ticket_search text DEFAULT NULL,
  p_customer_search text DEFAULT NULL,
  p_product_type text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_receiving_status text DEFAULT NULL,
  p_exclude_cancelled boolean DEFAULT false,
  p_exclude_archived boolean DEFAULT false,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS TABLE (
  item jsonb,
  total_tickets bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered_items AS (
    SELECT
      i.*,
      tk.ticket_number,
      tk.customer_name,
      pt.name AS product_type_name
    FROM public.items i
    JOIN public.tickets tk ON tk.id = i.ticket_id
    JOIN public.product_types pt ON pt.id = i.product_type_id
    WHERE i.organization_id = public.current_org_id()
      AND (p_ticket_search IS NULL OR tk.ticket_number ILIKE '%' || p_ticket_search || '%' OR i.item_key ILIKE '%' || p_ticket_search || '%')
      AND (p_customer_search IS NULL OR tk.customer_name ILIKE '%' || p_customer_search || '%')
      AND (p_product_type IS NULL OR pt.name = p_product_type)
      AND (
        p_category IS NULL OR EXISTS (
          SELECT 1
          FROM public.work_assignments w
          JOIN public.category_types ct ON ct.id = w.category_type_id
          WHERE w.item_id = i.id
            AND w.organization_id = public.current_org_id()
            AND ct.name = p_category
        )
      )
      AND (
        p_status IS NULL
        OR i.status::text = p_status
        OR (p_status = 'OUT_OF_PRODUCTION' AND i.status::text = 'COMPLETED')
        OR (p_status = 'IN_PRODUCTION' AND i.status::text = 'IN_QC')
      )
      AND (p_start_date IS NULL OR i.created_at >= p_start_date)
      AND (p_end_date IS NULL OR i.created_at <= p_end_date)
      AND (p_receiving_status IS NULL OR (CASE WHEN i.is_received THEN 'Received' ELSE 'Not Received' END) = p_receiving_status)
      AND (NOT p_exclude_cancelled OR i.status::text <> 'CANCELLED')
      AND (NOT p_exclude_archived OR i.status::text <> 'ARCHIVED')
  ),
  ticket_totals AS (
    SELECT COUNT(*)::bigint AS total_tickets
    FROM (SELECT DISTINCT ticket_id FROM filtered_items) tickets
  ),
  ticket_page AS (
    SELECT ticket_id
    FROM filtered_items
    GROUP BY ticket_id
    ORDER BY MAX(created_at) DESC, MAX(ticket_number) DESC
    LIMIT GREATEST(1, p_page_size)
    OFFSET GREATEST(0, (GREATEST(1, p_page) - 1) * GREATEST(1, p_page_size))
  )
  SELECT
    to_jsonb(fi) ||
    jsonb_build_object(
      'raw_status', fi.status,
      'receiving_status', CASE WHEN fi.is_received THEN 'Received' ELSE 'Not Received' END,
      'work_assignments', COALESCE(wa.assignments, '[]'::jsonb)
    ) AS item,
    tt.total_tickets
  FROM filtered_items fi
  JOIN ticket_page tp ON tp.ticket_id = fi.ticket_id
  CROSS JOIN ticket_totals tt
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', w.id,
        'category_type_id', w.category_type_id,
        'task_type_id', w.task_type_id,
        'tailor_id', w.tailor_id,
        'status', w.status,
        'pay_amount', w.pay_amount,
        'category_types', jsonb_build_object('name', ct.name),
        'task_types', jsonb_build_object('name', tt2.name),
        'tailors', jsonb_build_object('name', tr.name, 'active', tr.active, 'band', tr.band)
      )
      ORDER BY w.created_at DESC
    ) AS assignments
    FROM public.work_assignments w
    LEFT JOIN public.category_types ct ON ct.id = w.category_type_id
    LEFT JOIN public.task_types tt2 ON tt2.id = w.task_type_id
    LEFT JOIN public.tailors tr ON tr.id = w.tailor_id
    WHERE w.item_id = fi.id
      AND w.organization_id = public.current_org_id()
  ) wa ON true
  ORDER BY fi.created_at DESC, fi.item_key ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_ticket_paginated_items(text, text, text, text, text, timestamptz, timestamptz, text, boolean, boolean, integer, integer) TO authenticated;
