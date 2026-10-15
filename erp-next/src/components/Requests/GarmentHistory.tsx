'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatMoney } from '@/lib/formatters'
import { db } from '@/services/db'
import { Badge, Table, TableCell, TableRow } from '@/components/UI/Table'
import { amendmentLabel } from '@/lib/amendment-label'
import ReplacementTag from '@/components/Requests/ReplacementTag'

type Task = {
  id: string
  category: string | null
  task: string | null
  category_type_id: string
  task_type_id: string
  tailor_id: string
  tailor: string | null
  status: string
  pay_amount: number | null
  amendment_occurrence_id: string | null
  updated_at: string
}
type Amendment = { id: string; ordinal: number; note: string; approved_at: string }
type HistoryItem = {
  id: string
  item_key: string
  status: string
  product_name: string
  product_type_id: string
  replacement_of_item_id: string | null
  request_note: string | null
  amendments: Amendment[]
  tasks: Task[]
}
type History = { root_item_id: string; items: HistoryItem[] }
type Correction = { id: string; assignment_id: string; note: string; status: string; created_at: string; review_reason: string | null }

function taskStatus(status: string) {
  if (status === 'CREATED') return 'Awaiting QC'
  if (status === 'QC_PASSED') return 'QC passed / pay approved'
  if (status === 'QC_FAILED') return 'QC failed'
  if (status === 'PAID') return 'Paid'
  if (status === 'REVERSED') return 'Reversed'
  return status
}

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (['PAID', 'QC_PASSED', 'APPROVED', 'OUT_OF_PRODUCTION', 'COMPLETED'].includes(status)) return 'success'
  if (['QC_FAILED', 'REJECTED', 'REVERSED', 'CANCELLED'].includes(status)) return 'danger'
  if (['CREATED', 'PENDING', 'NEW', 'IN_PRODUCTION'].includes(status)) return 'warning'
  return 'neutral'
}

function itemStatus(status: string) {
  return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase())
}

export default function GarmentHistory({ itemId }: { itemId: string }) {
  const [history, setHistory] = useState<History | null>(null)
  const [error, setError] = useState('')
  const [correcting, setCorrecting] = useState<{ task: Task; item: HistoryItem } | null>(null)
  const [rates, setRates] = useState<{ product_type_id: string; category_type_id: string; task_type_id: string; category_name: string; name: string; active: boolean }[]>([])
  const [tailors, setTailors] = useState<{ id: string; name: string; active: boolean }[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [tailorId, setTailorId] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [corrections, setCorrections] = useState<Correction[]>([])

  useEffect(() => {
    let active = true
    void createClient().rpc('get_garment_work_history', { p_item_id: itemId }).then(({ data, error: loadError }) => {
      if (!active) return
      if (loadError) setError(loadError.message)
      else {
        const loaded = data as History
        setHistory(loaded)
        const ids = loaded.items.flatMap(item => item.tasks.map(task => task.id))
        if (ids.length) void createClient().from('work_assignment_corrections').select('id, assignment_id, note, status, created_at, review_reason').in('assignment_id', ids).order('created_at').then(({ data: rows }) => {
          if (active) setCorrections((rows || []) as Correction[])
        })
      }
    })
    return () => { active = false }
  }, [itemId])

  useEffect(() => {
    let active = true
    void Promise.all([db.getRates(), db.getTailors()]).then(([rateRows, tailorRows]) => {
      if (active) { setRates(rateRows); setTailors(tailorRows) }
    }).catch(cause => { if (active) setError(cause.message || 'Could not load correction options.') })
    return () => { active = false }
  }, [])

  function openCorrection(task: Task, item: HistoryItem) {
    setCorrecting({ task, item })
    setCategoryId(task.category_type_id)
    setTaskId(task.task_type_id)
    setTailorId(task.tailor_id)
    setNote('')
    setSaved(false)
    setError('')
  }

  async function submitCorrection() {
    if (!correcting) return
    setSaving(true)
    setError('')
    const { error: submitError } = await createClient().rpc('submit_work_assignment_correction', {
      p_assignment_id: correcting.task.id,
      p_category_type_id: categoryId,
      p_task_type_id: taskId,
      p_tailor_id: tailorId,
      p_note: note.trim(),
    })
    setSaving(false)
    if (submitError) setError(submitError.message)
    else {
      window.dispatchEvent(new Event('pending-requests-count:refresh'))
      setCorrecting(null)
      setSaved(true)
      setCorrections(rows => [...rows, { id: `new-${Date.now()}`, assignment_id: correcting.task.id, note: note.trim(), status: 'PENDING', created_at: new Date().toISOString(), review_reason: null }])
    }
  }

  if (error && !history) return <p role="alert" className="text-sm text-red-700">{error}</p>
  if (!history) return <p className="text-sm text-gray-500">Loading history...</p>

  const availableRates = correcting ? rates.filter(rate => rate.product_type_id === correcting.item.product_type_id && rate.active) : []
  const categories = [...new Map(availableRates.map(rate => [rate.category_type_id, rate.category_name])).entries()]

  return <div className="space-y-5">
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {saved && <p className="text-sm text-emerald-700">Correction submitted for Customer Service review.</p>}
    {correcting && <div className="space-y-3 border-b border-gray-200 pb-5">
      <h4 className="font-medium">Correct {correcting.item.item_key}: {correcting.task.task}</h4>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-gray-600">Category<select value={categoryId} onChange={event => { setCategoryId(event.target.value); setTaskId('') }} className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm">{categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs font-medium text-gray-600">Task<select value={taskId} onChange={event => setTaskId(event.target.value)} className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm"><option value="">Select task</option>{availableRates.filter(rate => rate.category_type_id === categoryId).map(rate => <option key={rate.task_type_id} value={rate.task_type_id}>{rate.name}</option>)}</select></label>
        <label className="text-xs font-medium text-gray-600">Tailor<select value={tailorId} onChange={event => setTailorId(event.target.value)} className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm">{tailors.filter(tailor => tailor.active).map(tailor => <option key={tailor.id} value={tailor.id}>{tailor.name}</option>)}</select></label>
      </div>
      <label className="block text-xs font-medium text-gray-600">Reason<textarea value={note} onChange={event => setNote(event.target.value)} rows={2} className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm" /></label>
      <div className="flex gap-2"><button type="button" disabled={saving || !note.trim() || !categoryId || !taskId || !tailorId} onClick={() => void submitCorrection()} className="rounded-md bg-maison-primary px-3 py-2 text-sm text-white disabled:opacity-50">Submit correction</button><button type="button" onClick={() => setCorrecting(null)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">Cancel</button></div>
    </div>}
    {history.items.map(item => <section key={item.id} className="space-y-4 border-b border-gray-200 pb-5 last:border-b-0 last:pb-0">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-serif text-lg text-maison-primary">{item.item_key}</h4>
          {item.replacement_of_item_id ? <ReplacementTag originalItemKey={history.items.find(origin => origin.id === item.replacement_of_item_id)?.item_key} /> : <Badge className="" variant="neutral">Original</Badge>}
          <Badge className="" variant={statusVariant(item.status)}>{itemStatus(item.status)}</Badge>
        </div>
        <p className="mt-1 text-sm text-maison-secondary">{item.product_name}</p>
        {item.request_note && <p className="mt-2 text-sm text-gray-700">Replacement reason: {item.request_note}</p>}
      </div>
      {item.amendments.length > 0 && <div className="space-y-2 border-t border-gray-100 pt-3">
        <h5 className="text-xs font-semibold uppercase text-gray-500">Amendments</h5>
        {item.amendments.map(amendment => <div key={amendment.id} className="flex flex-wrap items-start gap-2 text-sm text-gray-700">
          <Badge className="" variant="warning">{amendmentLabel(amendment.ordinal)}</Badge>
          <span className="min-w-0 flex-1">{amendment.note}</span>
        </div>)}
      </div>}
      {item.tasks.length > 0 ? <div className="space-y-2">
        <h5 className="text-xs font-semibold uppercase text-gray-500">Tasks</h5>
        <Table headers={['Category / Task', 'Tailor', 'QC / Payment', 'Pay']} className="" tableClassName="">
          {item.tasks.map(task => <TableRow key={task.id} className="" onClick={undefined}>
            <TableCell className=""><span className="font-medium">{task.task || '-'}</span><span className="block text-xs text-gray-500">{task.category || '-'}</span></TableCell>
            <TableCell className="">{task.tailor || '-'}</TableCell>
            <TableCell className=""><Badge className="" variant={statusVariant(task.status)}>{taskStatus(task.status)}</Badge><span className="mt-1 block text-xs text-gray-500">{new Date(task.updated_at).toLocaleString()}</span></TableCell>
            <TableCell className="text-right">{formatMoney(Number(task.pay_amount || 0))}{task.status === 'CREATED' && (task.amendment_occurrence_id || item.replacement_of_item_id) && <button type="button" onClick={() => openCorrection(task, item)} className="ml-2 text-xs text-maison-primary underline">Correct</button>}</TableCell>
          </TableRow>)}
        </Table>
      </div> : item.amendments.length === 0 && !item.request_note && <p className="border-t border-gray-100 pt-4 text-sm text-gray-500">No work recorded for this item.</p>}
      {item.tasks.flatMap(task => corrections.filter(correction => correction.assignment_id === task.id)).map(correction => <div key={correction.id} className="flex flex-wrap items-center gap-2 text-sm text-gray-700"><Badge className="" variant={statusVariant(correction.status)}>Correction {correction.status.toLowerCase()}</Badge><span>{correction.note}{correction.review_reason ? ` - ${correction.review_reason}` : ''}</span></div>)}
    </section>)}
  </div>
}
