'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/services/db'
import { formatMoney } from '@/lib/formatters'
import { Button } from '@/components/UI/Button'
import { Modal } from '@/components/UI/Modal'
import { Badge, Table, TableCell, TableRow } from '@/components/UI/Table'
import RequestForm from '@/components/Requests/RequestForm'
import type { WorkRequest } from '@/components/Requests/types'
import { amendmentLabel } from '@/lib/amendment-label'
import ReplacementTag from '@/components/Requests/ReplacementTag'

type Revision = { id: string; version: number; action: string; actor_user_id: string; created_at: string }
type Rate = { category_type_id: string; task_type_id: string; category_name: string; name: string }
type Tailor = { id: string; name: string }
type WorkHistory = { items: {
  id: string; item_key: string; replacement_of_item_id: string | null; request_note: string | null
  amendments: { id: string; ordinal: number; note: string }[]
  tasks: { amendment_occurrence_id: string | null; category: string | null; task: string | null }[]
}[] }
type Correction = {
  id: string
  assignment_id: string
  note: string
  created_by: string
  before_assignment: { category_type_id: string; task_type_id: string; tailor_id: string; pay_amount: number }
  proposed_assignment: { category_type_id: string; task_type_id: string; tailor_id: string }
  work_assignments?: { items?: { item_key?: string } | null } | null
}

const select = '*, items!work_change_requests_item_id_fkey(item_key, status, product_type_id, tickets(ticket_number, customer_name), product_types(name))'

export default function CustomerServiceRequestsClient({ userId, canReview }: { userId: string; canReview: boolean }) {
  const selectionToken = useRef(0)
  const [requests, setRequests] = useState<WorkRequest[]>([])
  const [requestTab, setRequestTab] = useState<'AMENDMENT' | 'REPLACEMENT'>('AMENDMENT')
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [selected, setSelected] = useState<WorkRequest | null>(null)
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [rates, setRates] = useState<Rate[]>([])
  const [tailors, setTailors] = useState<Tailor[]>([])
  const [quotedAmounts, setQuotedAmounts] = useState<(number | null)[]>([])
  const [workHistory, setWorkHistory] = useState<WorkHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error: loadError } = await supabase.from('work_change_requests')
      .select(select).eq('status', 'PENDING').order('created_at', { ascending: true }).limit(100)
    if (loadError) setError(loadError.message)
    else {
      try {
        const identities = await db.getReplacementIdentityForItems((data || []).map(request => request.item_id))
        setRequests((data || []).map(request => ({ ...request, replacement_of_item_id: identities.get(request.item_id)?.replacement_of_item_id || null, replacement_origin_key: identities.get(request.item_id)?.replacement_origin_key || null })) as WorkRequest[])
        setError('')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load replacement references.')
      }
    }

    const { data: correctionRows, error: correctionError } = await supabase.from('work_assignment_corrections')
      .select('*, work_assignments(items(item_key))').eq('status', 'PENDING').order('created_at', { ascending: true }).limit(100)
    if (correctionError && correctionError.code !== 'PGRST205') setError(correctionError.message)
    else setCorrections((correctionRows || []) as Correction[])
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => {
    let active = true
    Promise.all([db.getRates(), db.getTailors()]).then(([rateRows, tailorRows]) => {
      if (active) { setRates(rateRows); setTailors(tailorRows) }
    }).catch(cause => { if (active) setError(cause.message || 'Could not load task details.') })
    return () => { active = false }
  }, [])

  async function selectRequest(request: WorkRequest) {
    const token = ++selectionToken.current
    setSelected(request)
    setEditing(false)
    setRejecting(false)
    setReason('')
    setQuotedAmounts([])
    setWorkHistory(null)
    setHistoryLoading(true)
    const supabase = createClient()
    const { data: history, error: historyError } = await supabase.rpc('get_garment_work_history', { p_item_id: request.item_id })
    if (token !== selectionToken.current) return
    setHistoryLoading(false)
    if (historyError) setError(historyError.message)
    else setWorkHistory(history as WorkHistory)
    const { data, error: revisionError } = await supabase.from('work_change_request_revisions')
      .select('id, version, action, actor_user_id, created_at')
      .eq('request_id', request.id).order('version')
    if (token !== selectionToken.current) return
    if (revisionError) setError(revisionError.message)
    else setRevisions(data || [])
    const quotes = await Promise.all(request.proposed_assignments.map(async task => {
      const { data: pay, error: payError } = await supabase.rpc('calculate_assignment_pay', {
        p_item_id: request.item_id,
        p_category_type_id: task.category_type_id,
        p_task_type_id: task.task_type_id,
        p_tailor_id: task.tailor_id,
      })
      return payError || pay?.[0]?.final_fee == null ? null : Number(pay[0].final_fee)
    }))
    if (token !== selectionToken.current) return
    setQuotedAmounts(quotes)
  }

  function closeRequest() {
    selectionToken.current += 1
    setSelected(null)
    setWorkHistory(null)
  }

  async function review(decision: 'APPROVED' | 'REJECTED') {
    if (!selected || !canReview) return
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: reviewError } = decision === 'APPROVED'
      ? await supabase.rpc('approve_work_change_request', { p_request_id: selected.id, p_expected_version: selected.version })
      : await supabase.rpc('reject_work_change_request', { p_request_id: selected.id, p_expected_version: selected.version, p_reason: reason })
    setSaving(false)
    if (reviewError) { setError(reviewError.message); return }
    window.dispatchEvent(new Event('pending-requests-count:refresh'))
    closeRequest()
    setRevisions([])
    void load()
  }

  async function reviewCorrection(correction: Correction, approve: boolean) {
    if (!canReview) return
    const rejectionReason = approve ? null : window.prompt('Reason for rejecting this correction:')
    if (!approve && !rejectionReason?.trim()) return
    setSaving(true)
    setError('')
    const { error: reviewError } = await createClient().rpc('review_work_assignment_correction', {
      p_correction_id: correction.id, p_approve: approve, p_reason: rejectionReason,
    })
    setSaving(false)
    if (reviewError) setError(reviewError.message)
    else { window.dispatchEvent(new Event('pending-requests-count:refresh')); void load() }
  }

  function assignmentLabel(assignment: { category_type_id: string; task_type_id: string; tailor_id: string }) {
    const rate = rates.find(row => row.category_type_id === assignment.category_type_id && row.task_type_id === assignment.task_type_id)
    const tailor = tailors.find(row => row.id === assignment.tailor_id)
    return `${rate?.category_name || 'Category'} / ${rate?.name || 'Task'} / ${tailor?.name || 'Tailor'}`
  }

  const amendmentCount = requests.filter(request => request.kind === 'AMENDMENT').length
  const replacementCount = requests.filter(request => request.kind === 'REPLACEMENT').length
  const visibleRequests = requests.filter(request => request.kind === requestTab)

  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h1 className="font-serif text-2xl text-maison-primary">Pending Requests</h1>
        <p className="text-sm text-maison-secondary">Amendments, replacements, and assignment corrections awaiting review.</p>
      </div>
      <Button type="button" variant="secondary" size="sm" className="" isLoading={false} disabled={false} onClick={() => { closeRequest(); void load() }} aria-label="Refresh requests" title="Refresh requests"><RefreshCw className="h-4 w-4" /></Button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

    <section className="space-y-3">
      <div role="tablist" aria-label="Request type" className="flex gap-2">
        {([{ kind: 'AMENDMENT', label: 'Amendments', count: amendmentCount }, { kind: 'REPLACEMENT', label: 'Replacements', count: replacementCount }] as const).map(tab => <button key={tab.kind} type="button" role="tab" id={`requests-tab-${tab.kind.toLowerCase()}`} aria-selected={requestTab === tab.kind} aria-controls="pending-work-requests" onClick={() => setRequestTab(tab.kind)} className={requestTab === tab.kind ? 'inline-flex items-center gap-2 rounded-md bg-maison-primary px-4 py-2 text-sm font-medium text-white shadow-sm' : 'inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-maison-secondary hover:bg-gray-50'}>{tab.label}<span className={requestTab === tab.kind ? 'text-white/70' : 'text-gray-500'}>{tab.count}</span></button>)}
      </div>
      <div id="pending-work-requests" role="tabpanel" aria-labelledby={`requests-tab-${requestTab.toLowerCase()}`}>
      <Table headers={['Ticket', 'Customer', 'Item', 'Type', 'Note', 'Submitted', 'Actions']} className="" tableClassName="">
        {visibleRequests.map(request => <TableRow key={request.id} className="" onClick={undefined}>
          <TableCell className="font-mono text-xs">{request.items?.tickets?.ticket_number || '-'}</TableCell>
          <TableCell className="">{request.items?.tickets?.customer_name || '-'}</TableCell>
          <TableCell className="font-mono text-xs"><span className="block">{request.items?.item_key || '-'}</span>{request.replacement_of_item_id && <ReplacementTag originalItemKey={request.replacement_origin_key} className="mt-1" />}</TableCell>
          <TableCell className=""><Badge className="" variant={request.kind === 'AMENDMENT' ? 'warning' : 'brand'}>{request.kind === 'AMENDMENT' ? amendmentLabel(request.amendment_ordinal) : 'Replacement'}</Badge></TableCell>
          <TableCell className=""><span className="block max-w-xs truncate" title={request.note}>{request.note}</span></TableCell>
          <TableCell className="text-gray-500">{format(new Date(request.created_at), 'MMM d, yyyy')}</TableCell>
          <TableCell className=""><Button type="button" variant="secondary" size="sm" className="" isLoading={false} disabled={false} onClick={() => void selectRequest(request)}>Review</Button></TableCell>
        </TableRow>)}
        {visibleRequests.length === 0 && <TableRow className="" onClick={undefined}><td colSpan={7} className="px-6 py-10 text-center text-sm text-gray-500">No pending {requestTab === 'AMENDMENT' ? 'amendments' : 'replacements'}.</td></TableRow>}
      </Table>
      </div>
    </section>

    {corrections.length > 0 && <section className="space-y-3">
      <h2 className="font-serif text-lg text-maison-primary">Assignment Corrections <span className="ml-2 font-sans text-sm font-normal text-maison-secondary">{corrections.length}</span></h2>
      <Table headers={['Item', 'Reason', 'Current Assignment', 'Requested Change', 'Actions']} className="" tableClassName="">
        {corrections.map(correction => <TableRow key={correction.id} className="" onClick={undefined}>
          <TableCell className="font-mono text-xs">{correction.work_assignments?.items?.item_key || correction.assignment_id}</TableCell>
          <TableCell className=""><span className="block max-w-xs truncate" title={correction.note}>{correction.note}</span></TableCell>
          <TableCell className="">{assignmentLabel(correction.before_assignment)}</TableCell>
          <TableCell className="">{assignmentLabel(correction.proposed_assignment)}</TableCell>
          <TableCell className="">{canReview ? <div className="flex gap-2">
            <Button type="button" size="sm" className="" isLoading={false} disabled={saving || correction.created_by === userId} onClick={() => void reviewCorrection(correction, true)}>Approve</Button>
            <Button type="button" size="sm" variant="secondary" className="" isLoading={false} disabled={saving || correction.created_by === userId} onClick={() => void reviewCorrection(correction, false)}>Reject</Button>
          </div> : <span className="text-sm text-gray-500">Pending</span>}</TableCell>
        </TableRow>)}
      </Table>
    </section>}

    <Modal isOpen={Boolean(selected)} onClose={closeRequest} title={editing ? 'Edit Request' : 'Review Request'} maxWidth="max-w-4xl" scrollable>
      {selected && (editing && canReview ? <RequestForm key={`${selected.id}-${selected.version}`} request={selected} inModal onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); closeRequest(); void load() }} /> : <div className="space-y-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-serif text-lg text-maison-primary">{selected.items?.tickets?.customer_name || 'Customer'}</h2>
            <span className="font-mono text-sm text-gray-500">{selected.items?.item_key}</span>
            {selected.replacement_of_item_id && <ReplacementTag originalItemKey={selected.replacement_origin_key} />}
            <Badge className="" variant={selected.kind === 'AMENDMENT' ? 'warning' : 'brand'}>{selected.kind === 'AMENDMENT' ? 'Amendment request' : 'Replacement'}</Badge>
          </div>
          <p className="mt-1 text-sm text-maison-secondary">Ticket {selected.items?.tickets?.ticket_number || '-'} / {selected.items?.status}</p>
          <p className="mt-3 text-sm text-maison-primary">{selected.note}</p>
        </div>
        <section className="space-y-2 border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-maison-primary">Previous Amendments/Replacements</h3>
          {historyLoading ? <p className="text-sm text-maison-secondary">Loading history...</p> : workHistory ? <>
            <div className="divide-y divide-gray-200 rounded-md border border-gray-200">
              {workHistory.items.map(item => <div key={item.id} className="space-y-2 px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-maison-primary">{item.item_key}</span>
                  {item.replacement_of_item_id ? <ReplacementTag originalItemKey={workHistory.items.find(origin => origin.id === item.replacement_of_item_id)?.item_key} /> : <Badge className="" variant="neutral">Original</Badge>}
                  {item.id === selected.item_id && <span className="text-xs text-maison-secondary">Current item</span>}
                </div>
                {item.request_note && <p className="text-maison-secondary">{item.request_note}</p>}
                {item.amendments.map(amendment => <div key={amendment.id} className="flex flex-wrap items-start gap-2">
                  <Badge className="" variant="warning">{amendmentLabel(amendment.ordinal)}</Badge>
                  <span className="min-w-0 text-maison-secondary">{amendment.note}{item.tasks.some(task => task.amendment_occurrence_id === amendment.id) && ` / ${item.tasks.filter(task => task.amendment_occurrence_id === amendment.id).map(task => task.task || 'Task').join(', ')}`}</span>
                </div>)}
                {item.amendments.length === 0 && !item.replacement_of_item_id && <p className="text-xs text-maison-secondary">No approved amendments on this item.</p>}
              </div>)}
            </div>
          </> : <p className="text-sm text-red-700">History could not be loaded. Refresh before reviewing.</p>}
        </section>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-maison-primary">Proposed Tasks</h3>
          <Table headers={['Category', 'Task', 'Tailor', 'Est. Pay']} className="" tableClassName="">
            {selected.proposed_assignments.map((task, index) => {
              const rate = rates.find(row => row.category_type_id === task.category_type_id && row.task_type_id === task.task_type_id)
              const tailor = tailors.find(row => row.id === task.tailor_id)
              return <TableRow key={`${task.category_type_id}-${task.task_type_id}-${index}`} className="" onClick={undefined}>
                <TableCell className="">{rate?.category_name || 'Category'}</TableCell>
                <TableCell className="">{rate?.name || 'Task'}</TableCell>
                <TableCell className="">{tailor?.name || 'Tailor'}</TableCell>
                <TableCell className="">{quotedAmounts[index] === null || quotedAmounts[index] === undefined ? 'Calculating...' : formatMoney(quotedAmounts[index], { maximumFractionDigits: 0, minimumFractionDigits: 0 })}</TableCell>
              </TableRow>
            })}
          </Table>
        </div>
        <div className="space-y-2 border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-maison-primary">History</h3>
          {revisions.map(revision => <p key={revision.id} className="text-xs text-gray-600">Version {revision.version} / {revision.action.toLowerCase()} / {format(new Date(revision.created_at), 'MMM d, yyyy, h:mm a')}{revision.actor_user_id === userId ? ' / You' : ''}</p>)}
        </div>
        {canReview && <div className="space-y-3 border-t border-gray-200 pt-4">
          {selected.created_by === userId && <p className="text-xs text-gray-600">A different Customer Service user must review this request.</p>}
          {rejecting && <label className="block text-sm font-medium">Reason<textarea required value={reason} onChange={event => setReason(event.target.value)} rows={2} className="mt-1 w-full rounded-md border border-gray-300 p-2" /></label>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" className="" isLoading={false} disabled={false} onClick={() => setEditing(true)}>Edit</Button>
            <Button type="button" variant="secondary" className="" isLoading={false} disabled={saving || selected.created_by === userId} onClick={() => setRejecting(true)}>Reject</Button>
            {rejecting ? <Button type="button" variant="danger" className="" isLoading={false} disabled={saving || !reason.trim() || selected.created_by === userId} onClick={() => void review('REJECTED')}>Confirm Rejection</Button> : <Button type="button" className="" isLoading={false} disabled={saving || !workHistory || selected.created_by === userId} onClick={() => void review('APPROVED')}>Approve</Button>}
          </div>
        </div>}
      </div>)}
    </Modal>
  </div>
}
