-- Migration 010: Return production item summary counts for the full filtered dataset.

CREATE OR REPLACE FUNCTION public.get_production_item_summary(
  p_ticket_search text DEFAULT NULL,
  p_customer_search text DEFAULT NULL,
  p_product_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  total_backlog bigint,
  total_completed bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (
      WHERE i.status::text NOT IN ('OUT_OF_PRODUCTION', 'COMPLETED', 'ARCHIVED', 'CANCELLED')
    )::bigint AS total_backlog,
    COUNT(*) FILTER (
      WHERE i.status::text IN ('OUT_OF_PRODUCTION', 'COMPLETED')
    )::bigint AS total_completed
  FROM public.items i
  JOIN public.tickets tk ON tk.id = i.ticket_id
  JOIN public.product_types pt ON pt.id = i.product_type_id
  WHERE i.organization_id = public.current_org_id()
    AND (p_ticket_search IS NULL OR tk.ticket_number ILIKE '%' || p_ticket_search || '%' OR i.item_key ILIKE '%' || p_ticket_search || '%')
    AND (p_customer_search IS NULL OR tk.customer_name ILIKE '%' || p_customer_search || '%')
    AND (p_product_type IS NULL OR pt.name = p_product_type)
    AND (
      p_status IS NULL
      OR i.status::text = p_status
      OR (p_status = 'OUT_OF_PRODUCTION' AND i.status::text = 'COMPLETED')
      OR (p_status = 'IN_PRODUCTION' AND i.status::text = 'IN_QC')
    )
    AND (p_start_date IS NULL OR i.created_at >= p_start_date)
    AND (p_end_date IS NULL OR i.created_at <= p_end_date);
$$;

GRANT EXECUTE ON FUNCTION public.get_production_item_summary(text, text, text, text, timestamptz, timestamptz) TO authenticated;
