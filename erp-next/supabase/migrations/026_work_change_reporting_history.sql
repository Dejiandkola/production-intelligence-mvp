-- Read-only production breakdown and linked garment history.

CREATE FUNCTION public.get_production_origin_summary(
  p_ticket_search text DEFAULT NULL,
  p_customer_search text DEFAULT NULL,
  p_product_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  first_pass_backlog bigint,
  replacement_backlog bigint,
  first_pass_completed bigint,
  replacement_completed bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*) FILTER (WHERE i.replacement_of_item_id IS NULL AND i.status::text NOT IN ('OUT_OF_PRODUCTION', 'COMPLETED', 'ARCHIVED', 'CANCELLED')),
    count(*) FILTER (WHERE i.replacement_of_item_id IS NOT NULL AND i.status::text NOT IN ('OUT_OF_PRODUCTION', 'COMPLETED', 'ARCHIVED', 'CANCELLED')),
    count(*) FILTER (WHERE i.replacement_of_item_id IS NULL AND i.status::text IN ('OUT_OF_PRODUCTION', 'COMPLETED')),
    count(*) FILTER (WHERE i.replacement_of_item_id IS NOT NULL AND i.status::text IN ('OUT_OF_PRODUCTION', 'COMPLETED'))
  FROM public.items i
  JOIN public.tickets tk ON tk.id = i.ticket_id
  JOIN public.product_types pt ON pt.id = i.product_type_id
  WHERE auth.uid() IS NOT NULL
    AND i.organization_id = public.current_org_id()
    AND (p_ticket_search IS NULL OR tk.ticket_number ILIKE '%' || p_ticket_search || '%' OR i.item_key ILIKE '%' || p_ticket_search || '%')
    AND (p_customer_search IS NULL OR tk.customer_name ILIKE '%' || p_customer_search || '%')
    AND (p_product_type IS NULL OR pt.name = p_product_type)
    AND (p_status IS NULL OR i.status::text = p_status
      OR (p_status = 'OUT_OF_PRODUCTION' AND i.status::text = 'COMPLETED')
      OR (p_status = 'IN_PRODUCTION' AND i.status::text = 'IN_QC'))
    AND (p_start_date IS NULL OR i.created_at >= p_start_date)
    AND (p_end_date IS NULL OR i.created_at <= p_end_date);
$$;

CREATE FUNCTION public.get_garment_work_history(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_root_id uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT (
    public.has_permission('submit_work_requests')
    OR public.has_permission('manage_customer_service')
    OR public.has_permission('manage_production')
    OR public.has_permission('manage_qc')
    OR public.has_permission('manage_payments')
    OR public.has_permission('admin')
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  WITH RECURSIVE ancestors AS (
    SELECT i.id, i.replacement_of_item_id, i.ticket_id, 0 AS depth
    FROM public.items i WHERE i.id = p_item_id AND i.organization_id = v_org_id
    UNION ALL
    SELECT parent.id, parent.replacement_of_item_id, parent.ticket_id, a.depth + 1
    FROM ancestors a
    JOIN public.items parent ON parent.id = a.replacement_of_item_id
      AND parent.organization_id = v_org_id AND parent.ticket_id = a.ticket_id
    WHERE a.depth < 50
  )
  SELECT id INTO v_root_id FROM ancestors ORDER BY depth DESC LIMIT 1;

  IF v_root_id IS NULL THEN
    RAISE EXCEPTION 'Garment not found';
  END IF;

  WITH RECURSIVE lineage AS (
    SELECT i.id, i.replacement_of_item_id, i.ticket_id, 0 AS depth
    FROM public.items i WHERE i.id = v_root_id AND i.organization_id = v_org_id
    UNION ALL
    SELECT child.id, child.replacement_of_item_id, child.ticket_id, l.depth + 1
    FROM lineage l
    JOIN public.items child ON child.replacement_of_item_id = l.id
      AND child.organization_id = v_org_id AND child.ticket_id = l.ticket_id
    WHERE l.depth < 50
  ), item_history AS (
    SELECT jsonb_build_object(
      'id', i.id, 'item_key', i.item_key, 'status', i.status,
      'product_name', pt.name, 'product_type_id', i.product_type_id,
      'replacement_of_item_id', i.replacement_of_item_id,
      'created_at', i.created_at, 'depth', l.depth,
      'request_note', replacement_request.note,
      'amendments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ao.id, 'ordinal', ao.ordinal, 'note', r.note,
          'approved_at', r.reviewed_at
        ) ORDER BY ao.ordinal)
        FROM public.amendment_occurrences ao
        JOIN public.work_change_requests r ON r.id = ao.request_id
        WHERE ao.item_id = i.id AND ao.organization_id = v_org_id
      ), '[]'::jsonb),
      'tasks', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', wa.id, 'category', ct.name, 'task', tt.name,
          'category_type_id', wa.category_type_id, 'task_type_id', wa.task_type_id,
          'tailor_id', wa.tailor_id, 'tailor', tailor.name, 'status', wa.status,
          'pay_amount', wa.pay_amount, 'amendment_occurrence_id', wa.amendment_occurrence_id,
          'created_at', wa.created_at, 'updated_at', wa.updated_at
        ) ORDER BY wa.created_at, wa.id)
        FROM public.work_assignments wa
        LEFT JOIN public.category_types ct ON ct.id = wa.category_type_id
        LEFT JOIN public.task_types tt ON tt.id = wa.task_type_id
        LEFT JOIN public.tailors tailor ON tailor.id = wa.tailor_id
        WHERE wa.item_id = i.id AND wa.organization_id = v_org_id
      ), '[]'::jsonb)
    ) AS entry, l.depth, i.created_at, i.id
    FROM lineage l
    JOIN public.items i ON i.id = l.id
    JOIN public.product_types pt ON pt.id = i.product_type_id
    LEFT JOIN public.work_change_requests replacement_request
      ON replacement_request.id = i.approved_work_change_request_id
  )
  SELECT jsonb_build_object(
    'root_item_id', v_root_id,
    'items', COALESCE(jsonb_agg(entry ORDER BY depth, created_at, id), '[]'::jsonb)
  ) INTO v_result FROM item_history;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_production_origin_summary(text, text, text, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_garment_work_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_origin_summary(text, text, text, text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_garment_work_history(uuid) TO authenticated;
