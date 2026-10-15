export type ProposedAssignment = {
  category_type_id: string
  task_type_id: string
  tailor_id: string
}

export type WorkRequest = {
  id: string
  item_id: string
  replacement_of_item_id?: string | null
  replacement_origin_key?: string | null
  kind: 'AMENDMENT' | 'REPLACEMENT'
  amendment_ordinal: number | null
  note: string
  proposed_assignments: ProposedAssignment[]
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  version: number
  created_by: string
  reviewed_by: string | null
  review_reason: string | null
  created_at: string
  approved_snapshot: { target_item_id?: string; amendment_occurrence_id?: string } | null
  items: {
    item_key: string
    status: string
    product_type_id: string
    tickets: { ticket_number: string; customer_name: string | null } | null
    product_types: { name: string } | null
  } | null
}
