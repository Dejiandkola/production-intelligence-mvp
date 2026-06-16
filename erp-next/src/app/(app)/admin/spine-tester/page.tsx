'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
    createWorkAssignmentAction,
    qcPassAction,
    qcFailAction,
    createPaymentBatchAction,
    reversePaymentAction,
    cancelItemAction,
    cancelTicketAction,
} from '../../../actions/spine'

type ActionResult = { success: true; data: unknown } | { success: false; error: string }

export default function SpineTester() {
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<ActionResult | null>(null)

    const [itemId, setItemId] = useState('')
    const [categoryTypeId, setCategoryTypeId] = useState('')
    const [taskTypeId, setTaskTypeId] = useState('')
    const [tailorId, setTailorId] = useState('')
    const [assignmentId, setAssignmentId] = useState('')
    const [notes, setNotes] = useState('')

    // ✅ Debug: confirm you're logged in
    useEffect(() => {
        const supabase = createClient()
        supabase.auth.getUser().then((authResponse) => {
            const data = authResponse.data;
            const error = authResponse.error;
            console.log('Current User:', data.user)
            if (error) console.error('getUser error:', error.message)
            if (!data.user) console.warn('Not logged in (user is null)')
        })
    }, [])

    const handleAction = async (actionFn: () => Promise<unknown>) => {
        setLoading(true)
        setResult(null)
        try {
            const res = await actionFn()
            setResult({ success: true, data: res })
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            setResult({ success: false, error: message })
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-8 font-sans">
            <h1 className="text-2xl font-bold">Spine E2E Tester</h1>
            <p className="text-gray-600">
                Run state machine workflows without modifying backend tables directly.
                Note: You need active UUIDs for items, task types, etc., and permission in Auth session.
            </p>

            <div className="bg-gray-100 p-4 rounded space-y-2">
                <h2 className="font-semibold mb-2">Configure UUIDs</h2>
                <div className="grid grid-cols-2 gap-4">
                    <input className="border p-1" placeholder="Item ID" value={itemId} onChange={(e) => setItemId(e.target.value)} />
                    <input className="border p-1" placeholder="Category Type ID" value={categoryTypeId} onChange={(e) => setCategoryTypeId(e.target.value)} />
                    <input className="border p-1" placeholder="Task Type ID" value={taskTypeId} onChange={(e) => setTaskTypeId(e.target.value)} />
                    <input className="border p-1" placeholder="Tailor ID" value={tailorId} onChange={(e) => setTailorId(e.target.value)} />
                    <input className="border p-1" placeholder="Work Assignment ID" value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} />
                    <input className="border p-1" placeholder="Notes (QC Fail / Reversal)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <button
                    onClick={() => handleAction(() => createWorkAssignmentAction(itemId, categoryTypeId, taskTypeId, tailorId))}
                    disabled={loading || !itemId || !categoryTypeId || !taskTypeId || !tailorId}
                    className="bg-blue-600 text-white p-2 rounded disabled:opacity-50"
                >
                    1. Create Assignment
                </button>

                <button
                    onClick={() => handleAction(() => qcPassAction(assignmentId))}
                    disabled={loading || !assignmentId}
                    className="bg-green-600 text-white p-2 rounded disabled:opacity-50"
                >
                    2. QC Pass
                </button>

                <button
                    onClick={() => handleAction(() => qcFailAction(assignmentId, notes))}
                    disabled={loading || !assignmentId || !notes}
                    className="bg-red-600 text-white p-2 rounded disabled:opacity-50"
                >
                    2b. QC Fail (Requires Notes)
                </button>

                <button
                    onClick={() => handleAction(() => createPaymentBatchAction([assignmentId]))}
                    disabled={loading || !assignmentId}
                    className="bg-purple-600 text-white p-2 rounded disabled:opacity-50"
                >
                    3. Pay Assignment
                </button>

                <button
                    onClick={() => handleAction(() => reversePaymentAction(assignmentId, notes))}
                    disabled={loading || !assignmentId || !notes}
                    className="bg-orange-600 text-white p-2 rounded disabled:opacity-50"
                >
                    4. Reverse Payment (Admin, Req Notes)
                </button>
            </div>

            <hr />

            <h2 className="text-xl font-bold">Cancellation</h2>
            <div className="flex gap-4">
                <button
                    onClick={() => handleAction(() => cancelItemAction(itemId))}
                    disabled={loading || !itemId}
                    className="border-red-600 border text-red-600 p-2 rounded disabled:opacity-50 flex-1"
                >
                    Cancel Item
                </button>

                <button
                    onClick={() => handleAction(() => cancelTicketAction(notes))}
                    disabled={loading || !notes}
                    className="border-red-800 border text-red-800 p-2 rounded disabled:opacity-50 flex-1"
                >
                    Cancel Ticket (ID from Notes field)
                </button>
            </div>

            {result && (
                <div className={`p-4 rounded ${result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    <pre>{JSON.stringify(result, null, 2)}</pre>
                </div>
            )}
        </div>
    )
}
