'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { db } from '@/services/db'
import { createClient } from '@/lib/supabase/client'
import type { ProposedAssignment, WorkRequest } from './types'
import { amendmentLabel } from '@/lib/amendment-label'
import ReplacementTag from '@/components/Requests/ReplacementTag'

export type ItemOption = {
  id: string
  item_key: string
  status: string
  raw_status?: string
  product_type_id: string
  ticket_number?: string
  customer_name?: string
  product_type_name?: string
  replacement_of_item_id?: string | null
  replacement_origin_key?: string | null
}
type Rate = {
  id: string
  product_type_id: string
  category_type_id: string
  category_name: string
  task_type_id: string
  name: string
  active: boolean
}
type Tailor = { id: string; name: string; active: boolean }

type TaskGroup = { category_type_id: string; task_type_ids: string[]; tailor_id: string }
const emptyGroup = (): TaskGroup => ({ category_type_id: '', task_type_ids: [], tailor_id: '' })

function groupAssignments(assignments?: ProposedAssignment[], kind?: 'AMENDMENT' | 'REPLACEMENT'): TaskGroup[] {
  if (!assignments?.length) return [emptyGroup()]
  if (kind === 'REPLACEMENT') return assignments.map(assignment => ({
    category_type_id: assignment.category_type_id, task_type_ids: [assignment.task_type_id], tailor_id: assignment.tailor_id,
  }))
  const groups: TaskGroup[] = []
  for (const assignment of assignments) {
    let group = groups.find(row => row.category_type_id === assignment.category_type_id && row.tailor_id === assignment.tailor_id)
    if (!group) {
      group = { category_type_id: assignment.category_type_id, task_type_ids: [], tailor_id: assignment.tailor_id }
      groups.push(group)
    }
    group.task_type_ids.push(assignment.task_type_id)
  }
  return groups
}

function AmendmentTaskPicker({ index, options, selected, onChange }: {
  index: number
  options: Rate[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 240 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const visibleOptions = options.filter(rate => rate.name.toLowerCase().includes(search.trim().toLowerCase()))

  useEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const spaceBelow = window.innerHeight - rect.bottom - 12
      const spaceAbove = rect.top - 12
      const below = spaceBelow >= 180 || spaceBelow >= spaceAbove
      const maxHeight = Math.min(240, Math.max(100, below ? spaceBelow : spaceAbove))
      setPosition({ top: below ? rect.bottom + 4 : rect.top - maxHeight - 4, left: rect.left, width: rect.width, maxHeight })
    }
    const closeOutside = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) setOpen(false)
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('pointerdown', closeOutside)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('pointerdown', closeOutside)
    }
  }, [open])

  return <div className="mt-1.5 sm:mt-0">
    <button ref={triggerRef} type="button" aria-label={`Task ${index + 1} amendment types`} aria-expanded={open} onClick={() => setOpen(value => !value)} className="flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm font-normal text-maison-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-maison-primary">
      <span className="min-w-0 truncate">{selected.length ? `${selected.length} task${selected.length === 1 ? '' : 's'} selected` : 'Select tasks'}</span>
      <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
    </button>
    {open && createPortal(<div ref={panelRef} role="group" aria-label={`Task ${index + 1} amendment options`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); triggerRef.current?.focus() } }} style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }} className="fixed z-[60] flex flex-col rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
      <input type="search" aria-label="Search amendment tasks" placeholder="Search tasks..." value={search} onChange={event => setSearch(event.target.value)} className="mb-1 w-full shrink-0 rounded-md border border-gray-200 px-2 py-1.5 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-maison-primary/20" />
      <div className="min-h-0 space-y-0.5 overflow-y-auto">
        {visibleOptions.length ? visibleOptions.map(rate => <label key={rate.task_type_id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-normal text-maison-primary hover:bg-gray-50">
          <input type="checkbox" checked={selected.includes(rate.task_type_id)} onChange={() => onChange(selected.includes(rate.task_type_id) ? selected.filter(id => id !== rate.task_type_id) : [...selected, rate.task_type_id])} />
          <span>{rate.name}</span>
        </label>) : <p className="px-2 py-1.5 text-sm font-normal text-gray-500">{options.length ? 'No matching tasks.' : 'No tasks available.'}</p>}
      </div>
    </div>, document.body)}
  </div>
}

export default function RequestForm({
  request,
  selectedItem,
  initialKind,
  inModal = false,
  onSaved,
  onCancel,
}: {
  request?: WorkRequest | null
  selectedItem?: ItemOption | null
  initialKind?: 'AMENDMENT' | 'REPLACEMENT'
  inModal?: boolean
  onSaved: () => void
  onCancel: () => void
}) {
  const [item, setItem] = useState<ItemOption | null>(request?.items ? {
    id: request.item_id,
    item_key: request.items.item_key,
    status: request.items.status,
    product_type_id: request.items.product_type_id,
    ticket_number: request.items.tickets?.ticket_number,
    customer_name: request.items.tickets?.customer_name || undefined,
    product_type_name: request.items.product_types?.name,
    replacement_of_item_id: request.replacement_of_item_id,
    replacement_origin_key: request.replacement_origin_key,
  } : selectedItem || null)
  const [kind, setKind] = useState<'AMENDMENT' | 'REPLACEMENT'>(request?.kind || initialKind || 'AMENDMENT')
  const [note, setNote] = useState(request?.note || '')
  const [groups, setGroups] = useState<TaskGroup[]>(() => groupAssignments(request?.proposed_assignments, request?.kind))
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<ItemOption[]>([])
  const [rates, setRates] = useState<Rate[]>([])
  const [tailors, setTailors] = useState<Tailor[]>([])
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([db.getRates(), db.getTailors()])
      .then(([rateRows, tailorRows]) => {
        if (active) { setRates(rateRows); setTailors(tailorRows) }
      })
      .catch(cause => { if (active) setError(cause.message || 'Could not load tasks and tailors.') })
      .finally(() => { if (active) setLoadingOptions(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (request || selectedItem || query.trim().length < 2) {
      setMatches([])
      return
    }
    let active = true
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const result = await db.getTicketPaginatedItems({ ticketId: query.trim() }, 1, 20, { excludeArchived: true, excludeCancelled: true })
        if (active) setMatches((result.items || []).filter((row: ItemOption) => !['ARCHIVED', 'CANCELLED'].includes(row.status)))
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not search garments.')
      } finally {
        if (active) setSearching(false)
      }
    }, 300)
    return () => { active = false; clearTimeout(timer) }
  }, [query, request, selectedItem])

  const availableRates = rates.filter(rate =>
    rate.active && rate.product_type_id === item?.product_type_id &&
    (kind === 'REPLACEMENT' || rate.category_name?.toLowerCase() === 'amendment')
  )
  const categories = [...new Map(availableRates.map(rate => [rate.category_type_id, rate.category_name])).entries()]

  function updateGroup(index: number, patch: Partial<TaskGroup>) {
    setGroups(previous => previous.map((group, rowIndex) => rowIndex === index ? { ...group, ...patch } : group))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const assignments: ProposedAssignment[] = groups.flatMap(group => group.task_type_ids.map(task_type_id => ({
      category_type_id: group.category_type_id, task_type_id, tailor_id: group.tailor_id,
    })))
    if (!item || groups.some(row => !row.category_type_id || !row.task_type_ids.length || !row.tailor_id) || assignments.length > 20) {
      setError('Select a garment, task, and tailor for every row.')
      return
    }
    if (new Set(assignments.map(row => `${row.category_type_id}:${row.task_type_id}`)).size !== assignments.length) {
      setError('Each task can only be selected once per request.')
      return
    }
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: saveError } = await supabase.rpc('save_work_change_request', {
      p_request_id: request?.id || null,
      p_item_id: item.id,
      p_kind: kind,
      p_note: note,
      p_assignments: assignments,
      p_expected_version: request?.version || null,
    })
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    window.dispatchEvent(new Event('pending-requests-count:refresh'))
    onSaved()
  }

  return (
    <form onSubmit={submit} className={inModal ? 'space-y-5' : 'space-y-5 border-t border-gray-200 pt-5'}>
      {!inModal && <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-lg">{request ? 'Edit Request' : 'New Request'}</h2>
        <button type="button" onClick={onCancel} className="text-sm text-gray-600 hover:text-black">Cancel</button>
      </div>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!request && !selectedItem && <div>
        <label className="block text-sm font-medium" htmlFor="garment-search">Ticket or garment ID</label>
        <input id="garment-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search ticket number or item key" className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" />
        {searching && <p className="mt-1 text-xs text-gray-600">Searching...</p>}
        {matches.length > 0 && <div className="mt-2 max-h-48 overflow-y-auto border-y border-gray-200">
          {matches.map(match => <button key={match.id} type="button" onClick={() => { setItem(match); setMatches([]); setQuery(''); setGroups([emptyGroup()]) }} className="block w-full border-b border-gray-100 px-2 py-2 text-left text-sm hover:bg-gray-50">
            <span className="font-medium">{match.item_key}</span> · {match.ticket_number} · {match.customer_name || 'Customer'} · {match.product_type_name || 'Garment'}
          </button>)}
        </div>}
      </div>}
      {item && <div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3"><h2 className="font-serif text-xl text-maison-primary">{item.item_key}</h2><span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{item.product_type_name || 'Garment'}</span><span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{kind === 'AMENDMENT' ? request?.amendment_ordinal == null ? 'Amendment' : amendmentLabel(request.amendment_ordinal) : 'Replacement'}</span></div>
          {item.replacement_of_item_id && <ReplacementTag originalItemKey={item.replacement_origin_key} className="mt-2" />}
          <p className="mt-1 text-sm text-maison-secondary">Ticket: {item.ticket_number} | Customer: {item.customer_name || 'Customer'}</p>
        </div>
      </div>}
      {(request || !selectedItem) && <label className="block text-sm font-medium text-maison-secondary">Type
        <select value={kind} onChange={event => { setKind(event.target.value as 'AMENDMENT' | 'REPLACEMENT'); setGroups([emptyGroup()]) }} className="mt-1.5 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20">
          <option value="AMENDMENT">Amendment</option>
          <option value="REPLACEMENT">Replacement</option>
        </select>
      </label>}
      <label className="block text-sm font-medium text-maison-secondary">Note *
        <textarea required maxLength={2000} rows={3} value={note} onChange={event => setNote(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20" />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-maison-secondary">Tasks and tailors *</span>
        <button type="button" disabled={!item || groups.length >= 20 || groups.reduce((count, group) => count + group.task_type_ids.length, 0) >= 20} onClick={() => setGroups(rows => [...rows, emptyGroup()])} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-sm text-maison-secondary hover:bg-gray-100 hover:text-maison-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maison-primary disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Add Task</button>
      </div>
      <div className="rounded-lg border border-gray-200 shadow-sm">
        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_40px] gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-medium uppercase text-gray-500 sm:grid"><span>Category</span><span>Task</span><span>Tailor</span><span className="sr-only">Actions</span></div>
        {groups.map((group, index) => {
          const taskOptions = availableRates.filter(rate => rate.category_type_id === group.category_type_id)
          const isAmendment = kind === 'AMENDMENT'
          return <div key={index} className="grid grid-cols-1 gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_40px] sm:items-center">
            <label className="min-w-0 text-sm font-medium text-maison-secondary"><span className="sm:sr-only">Category</span>
              <select required aria-label={`Task ${index + 1} category`} value={group.category_type_id} onChange={event => updateGroup(index, { category_type_id: event.target.value, task_type_ids: [] })} className="mt-1.5 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 sm:mt-0">
                <option value="">Select category</option>
                {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <div className="min-w-0 text-sm font-medium text-maison-secondary"><span className="sm:sr-only">Task</span>
              {isAmendment ? <AmendmentTaskPicker index={index} options={taskOptions} selected={group.task_type_ids} onChange={ids => updateGroup(index, { task_type_ids: ids })} /> : <select required aria-label={`Task ${index + 1} type`} value={group.task_type_ids[0] || ''} onChange={event => updateGroup(index, { task_type_ids: event.target.value ? [event.target.value] : [] })} className="mt-1.5 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 sm:mt-0">
                <option value="">Select task</option>
                {taskOptions.map(rate => <option key={rate.task_type_id} value={rate.task_type_id}>{rate.name}</option>)}
              </select>}
            </div>
            <label className="min-w-0 text-sm font-medium text-maison-secondary"><span className="sm:sr-only">Tailor</span>
              <select required aria-label={`Task ${index + 1} tailor`} value={group.tailor_id} onChange={event => updateGroup(index, { tailor_id: event.target.value })} className="mt-1.5 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 sm:mt-0">
                <option value="">Select tailor</option>
                {tailors.filter(tailor => tailor.active || tailor.id === group.tailor_id).map(tailor => <option key={tailor.id} value={tailor.id}>{tailor.name}</option>)}
              </select>
            </label>
            <button type="button" aria-label={`Remove task ${index + 1}`} title="Remove task" disabled={groups.length === 1} onClick={() => setGroups(rows => rows.filter((_, rowIndex) => rowIndex !== index))} className="self-end justify-self-start rounded-md p-2 text-gray-500 hover:bg-gray-200 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
          </div>
        })}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
        {inModal && <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-maison-secondary hover:bg-gray-100">Cancel</button>}
        <button type="submit" disabled={saving || loadingOptions || !item} className="rounded-lg bg-maison-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-black disabled:opacity-50">{saving ? 'Saving...' : request ? 'Save Changes' : 'Submit Request'}</button>
      </div>
    </form>
  )
}
