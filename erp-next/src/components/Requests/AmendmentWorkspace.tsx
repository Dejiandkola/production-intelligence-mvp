'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatMoney } from '@/lib/formatters'
import { db } from '@/services/db'
import { amendmentLabel } from '@/lib/amendment-label'
import { Badge, Table, TableCell, TableRow } from '@/components/UI/Table'
import { Modal } from '@/components/UI/Modal'
import RequestForm, { type ItemOption } from './RequestForm'

type Assignment = { assignment_id: string | null; category_type_id: string; task_type_id: string; tailor_id: string; status?: string; amendment_completed_at?: string | null }
type Task = { id: string; category_type_id: string; task_type_id: string; tailor_id: string; category: string; task: string; tailor: string; pay_amount: number; status: string; amendment_completed_at: string | null; amendment_occurrence_id: string | null }
type Round = { id: string; version: number; note: string; ordinal: number; assignments: Assignment[] }
type Context = { has_previous: boolean; previous_occurrence_id: string | null; previous_completed: boolean; can_attest: boolean; tasks: { category_type_id: string; task_type_id: string; task: string }[] }
type HistoryItem = { id: string; item_key: string; tasks: Task[]; amendments: { id: string; ordinal: number; note: string }[] }
type Rate = { product_type_id: string; category_type_id: string; category_name: string; task_type_id: string; name: string; active: boolean }

function TaskSelect({ options, row, blocked, index, disabled, onChange }: { options: Rate[]; row: Assignment; blocked: Set<string>; index: number; disabled: boolean; onChange: (rate: Rate) => void }) {
  const panel = useRef<HTMLDetailsElement>(null)
  const selected = options.find(rate => rate.category_type_id === row.category_type_id && rate.task_type_id === row.task_type_id)
  return <div className="text-xs text-gray-500"><span id={`round-task-${index}`}>Task</span>
    <details ref={panel} className="relative mt-1" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}>
      <summary aria-labelledby={`round-task-${index}`} aria-disabled={disabled} onClick={event => { if (disabled) event.preventDefault() }} className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-gray-200 bg-white p-2 text-sm text-maison-primary"><span>{selected?.name || (row.task_type_id ? 'Existing inactive task' : 'Select task')}</span><ChevronDown className="h-4 w-4 shrink-0" /></summary>
      <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white p-1">
        {options.map(rate => {
          const key = `${rate.category_type_id}:${rate.task_type_id}`
          const unavailable = blocked.has(key)
          return <button key={key} type="button" disabled={disabled || unavailable} onClick={() => { onChange(rate); if (panel.current) panel.current.open = false }} className="flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm text-maison-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"><span className={unavailable ? 'line-through' : ''}>{rate.name}</span>{unavailable && <span className="shrink-0 text-xs">Already assigned</span>}</button>
        })}
      </div>
    </details>
  </div>
}

function taskStatus(task: Task) {
  if (task.status === 'PAID') return 'Paid'
  if (task.status === 'QC_PASSED') return task.amendment_occurrence_id ? 'Approved' : 'QC passed'
  if (task.status === 'QC_FAILED') return 'Rejected'
  if (task.status === 'REVERSED') return 'Reversed'
  if (task.amendment_completed_at) return 'Completed'
  return task.amendment_occurrence_id ? 'In progress' : 'Awaiting QC'
}

export default function AmendmentWorkspace({ item, onSaved, onClose }: { item: ItemOption; onSaved: () => void; onClose: () => void }) {
  const [round, setRound] = useState<Round | null>(null)
  const [context, setContext] = useState<Context | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [rows, setRows] = useState<Assignment[]>([])
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [adding, setAdding] = useState(false)
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)
  const [reason, setReason] = useState('')
  const [rates, setRates] = useState<Rate[]>([])
  const [tailors, setTailors] = useState<{ id: string; name: string; active: boolean }[]>([])
  const [pendingCorrections, setPendingCorrections] = useState<Set<string>>(new Set())
  const [verifiedBy, setVerifiedBy] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState('')
  const [newRound, setNewRound] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    const client = createClient()
    void Promise.all([
      client.rpc('get_current_amendment_round', { p_item_id: item.id }),
      client.rpc('get_additional_amendment_context', { p_item_id: item.id }),
      client.rpc('get_garment_work_history', { p_item_id: item.id }),
      db.getRates(), db.getTailors(),
    ]).then(async ([current, eligibility, workHistory, rateRows, tailorRows]) => {
      if (!active) return
      const loadError = current.error || eligibility.error || workHistory.error
      if (loadError) throw new Error(loadError.message)
      const loaded = current.data as Round | null
      const ids = loaded?.assignments.map(row => row.assignment_id).filter((id): id is string => Boolean(id)) || []
      const [pending, completed] = await Promise.all([
        ids.length ? client.from('work_assignment_corrections').select('assignment_id').in('assignment_id', ids).eq('status', 'PENDING') : Promise.resolve({ data: [], error: null }),
        ids.length ? client.from('work_assignments').select('id, amendment_completed_by').in('id', ids) : Promise.resolve({ data: [], error: null }),
      ])
      const userIds = [...new Set((completed.data || []).map(task => task.amendment_completed_by).filter((id): id is string => Boolean(id)))]
      const profiles = userIds.length ? await client.from('profiles').select('user_id, full_name').in('user_id', userIds) : { data: [], error: null }
      if (!active) return
      if (pending.error || completed.error || profiles.error) throw new Error(pending.error?.message || completed.error?.message || profiles.error?.message)
      setRound(loaded)
      setContext(eligibility.data as Context)
      setHistory((workHistory.data as { items: HistoryItem[] }).items)
      setPendingCorrections(new Set((pending.data || []).map(row => row.assignment_id)))
      const names = new Map((profiles.data || []).map(profile => [profile.user_id, profile.full_name || '-']))
      setVerifiedBy(new Map((completed.data || []).map(task => [task.id, names.get(task.amendment_completed_by) || '-'])))
      setRates(rateRows)
      setTailors(tailorRows)
      setError('')
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load amendments.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [item.id, revision])

  const eligible = !['ARCHIVED', 'CANCELLED'].includes(item.raw_status || item.status)
  const currentItem = history.find(row => row.id === item.id)
  const currentTasks = currentItem?.tasks.filter(task => task.amendment_occurrence_id === context?.previous_occurrence_id && Boolean(task.amendment_occurrence_id)) || []
  const activeAssignments = round?.assignments || []
  const canAdd = eligible && (!context?.has_previous || Boolean(round && activeAssignments.length < 20 && (!activeAssignments.length || activeAssignments.some(task => task.status === 'CREATED' && !task.amendment_completed_at))))
  const options = [...new Map(rates.filter(rate => rate.active && rate.product_type_id === item.product_type_id && rate.category_name?.toLowerCase() === 'amendment').map(rate => [`${rate.category_type_id}:${rate.task_type_id}`, rate])).values()]
  function refresh(message: string) {
    setSuccess(message)
    setAdding(false)
    setEditingTask(null)
    setDeletingTask(null)
    setNewRound(false)
    setLoading(true)
    setRevision(value => value + 1)
    onSaved()
  }
  function openEditor(task: Task | null) {
    setEditingTask(task)
    setAdding(!task)
    setRows([{ assignment_id: task?.id || null, category_type_id: task?.category_type_id || '', task_type_id: task?.task_type_id || '', tailor_id: task?.tailor_id || '' }])
    setReason('')
    setFormError('')
    setSuccess('')
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!round || saving) return
    setSaving(true)
    setFormError('')
    try {
      const client = createClient()
      const { error: saveError } = editingTask ? await client.rpc('correct_amendment_round_task', {
        p_request_id: round.id, p_expected_version: round.version,
        p_assignment_id: editingTask.id, p_category_type_id: rows[0].category_type_id,
        p_task_type_id: rows[0].task_type_id, p_tailor_id: rows[0].tailor_id, p_reason: reason,
      }) : await client.rpc('add_amendment_round_tasks', {
        p_request_id: round.id, p_expected_version: round.version, p_reason: reason,
        p_assignments: rows.map(({ category_type_id, task_type_id, tailor_id }) => ({ category_type_id, task_type_id, tailor_id })),
      })
      if (saveError) throw new Error(saveError.message)
      refresh(editingTask ? 'Assignment updated.' : 'Tasks added to the current amendment round.')
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Could not save changes.') }
    finally { setSaving(false) }
  }
  async function deleteAssignment(event: React.FormEvent) {
    event.preventDefault()
    if (!round || !deletingTask || saving) return
    setSaving(true)
    setFormError('')
    try {
      const { error: deleteError } = await createClient().rpc('delete_amendment_assignment', {
        p_request_id: round.id, p_expected_version: round.version,
        p_assignment_id: deletingTask.id, p_reason: reason,
      })
      if (deleteError) throw new Error(deleteError.message)
      window.dispatchEvent(new Event('pending-requests-count:refresh'))
      refresh('Assignment deleted.')
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Could not delete assignment.') }
    finally { setSaving(false) }
  }
  function renderTasks(tasks: Task[], allowEdit: boolean) {
    return <Table headers={['Category', 'Task', 'Tailor', 'Est. Pay', 'Status', 'Verified By', 'Actions']} className="[&_th]:px-3 [&_td]:px-3 [&_td]:py-3" tableClassName="">
      {tasks.map(task => {
        const deletable = allowEdit && eligible && Boolean(task.amendment_occurrence_id) && task.amendment_occurrence_id === context?.previous_occurrence_id && !task.amendment_completed_at && task.status === 'CREATED'
        const editable = deletable && !pendingCorrections.has(task.id)
        const taskRound = currentItem?.amendments.find(amendment => amendment.id === task.amendment_occurrence_id)
        return <TableRow key={task.id} className="" onClick={undefined}>
          <TableCell className=""><span className="block max-w-24 whitespace-normal">{task.category || '-'}</span></TableCell>
          <TableCell className=""><span className="block max-w-36 whitespace-normal">{task.task || '-'}</span>{taskRound && <span className="mt-1 block text-xs text-gray-500">{amendmentLabel(taskRound.ordinal)}</span>}</TableCell>
          <TableCell className=""><span className="block max-w-28 whitespace-normal">{task.tailor || '-'}</span></TableCell>
          <TableCell className="">{formatMoney(Number(task.pay_amount || 0))}</TableCell>
          <TableCell className=""><Badge className="" variant={['QC_PASSED', 'PAID'].includes(task.status) ? 'success' : task.status === 'QC_FAILED' ? 'danger' : 'neutral'}>{taskStatus(task)}</Badge></TableCell>
          <TableCell className=""><span className="block max-w-28 whitespace-normal">{verifiedBy.get(task.id) || '-'}</span></TableCell>
          <TableCell className="w-20"><div className="flex items-center gap-1">{editable && <button type="button" title="Edit assignment" aria-label={`Edit ${task.task || 'task'} assignment`} onClick={() => openEditor(task)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-maison-primary hover:bg-gray-100"><Pencil className="h-4 w-4" /></button>}{deletable && <button type="button" title="Delete mistaken assignment" aria-label={`Delete ${task.task || 'task'} assignment`} onClick={() => { setDeletingTask(task); setReason(''); setFormError('') }} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}{!deletable && <span className="text-xs text-gray-400">-</span>}</div>{pendingCorrections.has(task.id) && <span className="text-xs text-gray-400">Correction pending</span>}</TableCell>
        </TableRow>
      })}
    </Table>
  }
  if (loading) return <p className="text-sm text-gray-500">Loading amendments...</p>
  if (!context || !currentItem) return <div className="space-y-3"><p role="alert" className="text-sm text-red-700">{error || 'Could not load amendments.'}</p><button type="button" onClick={onClose} className="text-sm">Close</button></div>
  const otherTasks = currentItem.tasks.filter(task => !currentTasks.some(current => current.id === task.id))
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-serif text-xl">{item.item_key}</h2><Badge className="" variant="neutral">{item.product_type_name || 'Garment'}</Badge></div><p className="mt-1 text-sm text-gray-500">Ticket: {item.ticket_number} | Customer: {item.customer_name || 'Customer'}</p></div>
      <button type="button" disabled={!canAdd} title={!canAdd ? 'The current round is completed or locked' : 'Add task to the current round'} onClick={() => openEditor(null)} className="inline-flex items-center gap-2 rounded-md bg-maison-primary px-4 py-2 text-sm text-white shadow-sm hover:bg-black disabled:opacity-50"><Plus className="h-4 w-4" />Add Task</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
    {round && <div className="space-y-2"><h3 className="text-sm font-semibold">{amendmentLabel(round.ordinal)}</h3><p className="text-sm text-gray-500">{round.note}</p></div>}
    {currentItem.tasks.length ? renderTasks([...currentTasks, ...otherTasks], true) : <p className="border-y border-gray-200 py-6 text-sm text-gray-500">No tasks assigned.</p>}
    {context.has_previous && context.previous_completed && !canAdd && <p className="text-sm text-gray-500">This round is completed. Use New Amendment Round for further work.</p>}
    {context.has_previous && <div className="space-y-3 border-t border-gray-200 pt-4">
      {!context.previous_completed && !context.can_attest && <p className="text-sm text-amber-800">{round && !activeAssignments.length ? 'No active tasks in this round. Use Add Task to assign work in this round.' : 'Confirm the current round as Completed in Requests before starting a new round.'}</p>}
      <div className="flex justify-end"><button type="button" disabled={!eligible || (!context.previous_completed && !context.can_attest)} onClick={() => setNewRound(true)} className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">New Amendment Round</button></div>
    </div>}
    <Modal isOpen={Boolean(deletingTask)} onClose={() => { if (!saving) setDeletingTask(null) }} title="Delete amendment assignment" maxWidth="max-w-lg" scrollable>
      {deletingTask && <form onSubmit={deleteAssignment} className="space-y-4">
        <p className="text-sm text-gray-700">Permanently delete <strong>{deletingTask.task}</strong> assigned to <strong>{deletingTask.tailor || 'this tailor'}</strong>? This cannot be undone. A deletion audit entry will be retained.</p>
        {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
        <label className="block text-sm text-gray-600">Reason for deletion<textarea required maxLength={2000} disabled={saving} value={reason} onChange={event => setReason(event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-gray-200 p-2" /></label>
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4"><button type="button" disabled={saving} onClick={() => setDeletingTask(null)} className="rounded-md px-3 py-2 text-sm hover:bg-gray-50">Keep Assignment</button><button type="submit" disabled={saving || !reason.trim()} className="rounded-md bg-red-700 px-3 py-2 text-sm text-white hover:bg-red-800 disabled:opacity-50">{saving ? 'Deleting...' : 'Delete Assignment'}</button></div>
      </form>}
    </Modal>
    <Modal isOpen={Boolean(editingTask) || (adding && Boolean(context.has_previous))} onClose={() => { if (!saving) { setEditingTask(null); setAdding(false) } }} title={editingTask ? 'Edit assignment' : `Add tasks to ${amendmentLabel(round?.ordinal)}`} maxWidth="max-w-2xl" scrollable>
      <form onSubmit={save} className="space-y-4">
        {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
        {rows.map((row, index) => <div key={row.assignment_id || `added-${index}`} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_36px]">
          <TaskSelect options={options} row={row} index={index} disabled={saving} blocked={new Set([...currentTasks.filter(task => task.id !== editingTask?.id), ...rows.filter((_, i) => i !== index)].map(task => `${task.category_type_id}:${task.task_type_id}`))} onChange={rate => setRows(previous => previous.map((entry, i) => i === index ? { ...entry, category_type_id: rate.category_type_id, task_type_id: rate.task_type_id } : entry))} />
          <label className="text-xs text-gray-500">Tailor<select required disabled={saving} value={row.tailor_id} onChange={event => setRows(previous => previous.map((entry, i) => i === index ? { ...entry, tailor_id: event.target.value } : entry))} className="mt-1 w-full rounded-md border border-gray-200 bg-white p-2 text-sm"><option value="">Select tailor</option>{tailors.filter(tailor => tailor.active || tailor.id === row.tailor_id).map(tailor => <option key={tailor.id} value={tailor.id}>{tailor.name}</option>)}</select></label>
          {!editingTask && rows.length > 1 && <button type="button" title="Remove unsaved task" aria-label={`Remove unsaved task ${index + 1}`} disabled={saving} onClick={() => setRows(previous => previous.filter((_, i) => i !== index))} className="mt-5 rounded p-2 text-gray-500 hover:bg-gray-100"><Trash2 className="h-4 w-4" /></button>}
        </div>)}
        {!editingTask && <button type="button" disabled={saving || rows.length + activeAssignments.length >= 20} onClick={() => setRows(previous => [...previous, { assignment_id: null, category_type_id: '', task_type_id: '', tailor_id: '' }])} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-gray-100"><Plus className="h-4 w-4" />Add Task</button>}
        <label className="block text-sm text-gray-600">Reason<textarea required maxLength={2000} disabled={saving} value={reason} onChange={event => setReason(event.target.value)} rows={2} className="mt-1 w-full rounded-md border border-gray-200 p-2" /></label>
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4"><button type="button" disabled={saving} onClick={() => { setEditingTask(null); setAdding(false) }} className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button><button type="submit" disabled={saving || !round || !reason.trim() || rows.some(row => !row.category_type_id || !row.task_type_id || !row.tailor_id)} className="rounded-md bg-maison-primary px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Saving...' : editingTask ? 'Save Changes' : 'Assign Tasks'}</button></div>
      </form>
    </Modal>
    <Modal isOpen={newRound || (adding && !context.has_previous)} onClose={() => { setNewRound(false); setAdding(false) }} title={newRound ? 'New Amendment Round' : 'Assign Amendment'} maxWidth="max-w-4xl" scrollable>
      <RequestForm selectedItem={item} initialKind="AMENDMENT" additionalRound={newRound ? context : undefined} inModal onCancel={() => { setNewRound(false); setAdding(false) }} onSaved={() => refresh('Amendment assigned.')} />
    </Modal>
  </div>
}
