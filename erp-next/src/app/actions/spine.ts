'use server'

import { createClient } from '@/lib/supabase/server'

// We wrap the DB RPC calls in Server Actions so the Next.js frontend can call them easily 
// and securely, allowing the frontend to ignore DB mechanics entirely.

export async function createWorkAssignmentAction(itemId: string, categoryTypeId: string, taskTypeId: string, tailorId: string) {
    // DB layer already enforces permissions inside the RPC!
    // But we can check here explicitly or let the DB do it. 
    // Let's rely on the DB RPC's internal SECURITY DEFINER + auth.has_permission checks,
    // We just need to pass the currently authenticated session headers via our Server Client.

    const supabase = await createClient()

    const { data, error } = await supabase.rpc('create_work_assignment', {
        p_item_id: itemId,
        p_category_type_id: categoryTypeId,
        p_task_type_id: taskTypeId,
        p_tailor_id: tailorId
    })

    if (error) {
        throw new Error(error.message)
    }
    return data
}

export async function qcPassAction(assignmentId: string) {
    const supabase = await createClient()
    const { error } = await supabase.rpc('qc_pass', {
        p_assignment_id: assignmentId
    })

    if (error) throw new Error(error.message)
    return { success: true }
}

export async function qcFailAction(assignmentId: string, notes: string) {
    const supabase = await createClient()
    const { error } = await supabase.rpc('qc_fail', {
        p_assignment_id: assignmentId,
        p_notes: notes
    })

    if (error) throw new Error(error.message)
    return { success: true }
}

export async function createPaymentBatchAction(assignmentIds: string[]) {
    const supabase = await createClient()
    const { error } = await supabase.rpc('create_payment_batch', {
        p_assignment_ids: assignmentIds
    })

    if (error) throw new Error(error.message)
    return { success: true }
}

export async function reversePaymentAction(assignmentId: string, reason: string) {
    const supabase = await createClient()
    const { error } = await supabase.rpc('reverse_payment', {
        p_assignment_id: assignmentId,
        p_reason: reason
    })

    if (error) throw new Error(error.message)
    return { success: true }
}

export async function cancelItemAction(itemId: string) {
    const supabase = await createClient()
    const { error } = await supabase.rpc('cancel_item', {
        p_item_id: itemId
    })

    if (error) throw new Error(error.message)
    return { success: true }
}

export async function cancelTicketAction(ticketId: string) {
    const supabase = await createClient()
    const { error } = await supabase.rpc('cancel_ticket', {
        p_ticket_id: ticketId
    })

    if (error) throw new Error(error.message)
    return { success: true }
}
