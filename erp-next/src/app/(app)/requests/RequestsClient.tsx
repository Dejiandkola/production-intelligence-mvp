'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FilterX, Pencil, Search } from 'lucide-react'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/services/db'
import { Card } from '@/components/UI/Card'
import { Button } from '@/components/UI/Button'
import { Modal } from '@/components/UI/Modal'
import { Badge, Table, TableCell, TableRow } from '@/components/UI/Table'
import RequestForm, { type ItemOption } from '@/components/Requests/RequestForm'
import type { WorkRequest } from '@/components/Requests/types'
import { amendmentLabel } from '@/lib/amendment-label'
import ReplacementTag from '@/components/Requests/ReplacementTag'
import GarmentHistory from '@/components/Requests/GarmentHistory'

type Garment = ItemOption & { ticket_id: string; created_at?: string; replacement_of_item_id?: string | null; replacement_origin_key?: string | null; work_assignments?: { category_types?: { name?: string } }[] }
type AmendmentTask = { id: string; status: string; task_types: { name: string } | { name: string }[] | null }
type ListedRequest = WorkRequest & { submitted_by: string; amendment_tasks: AmendmentTask[] }
type FormState = { item: Garment; kind: 'AMENDMENT' | 'REPLACEMENT' } | WorkRequest | null
type Filters = { ticketId: string; customerName: string; productType: string; status: string; startDate: string; endDate: string }
type RequestFilters = { ticketId: string; customerName: string; itemKey: string; kind: string; status: string; startDate: string; endDate: string }

const pageSize = 20
const requestPageSize = 50
const requestSelect = '*, items!work_change_requests_item_id_fkey(item_key, status, product_type_id, tickets(ticket_number, customer_name), product_types(name))'
const filteredRequestSelect = '*, items!work_change_requests_item_id_fkey!inner(item_key, status, product_type_id, tickets!inner(ticket_number, customer_name), product_types(name))'
const initialFilters: Filters = { ticketId: '', customerName: '', productType: '', status: '', startDate: '', endDate: '' }
const initialRequestFilters: RequestFilters = { ticketId: '', customerName: '', itemKey: '', kind: '', status: '', startDate: '', endDate: '' }
const statuses = [
  { value: '', label: 'All' },
  { value: 'NEW', label: 'New' },
  { value: 'IN_PRODUCTION', label: 'In Production' },
  { value: 'OUT_OF_PRODUCTION', label: 'Out of Production' },
  { value: 'ARCHIVED', label: 'Archived' },
]

function categoryBadgeClass(name: string) {
  const category = name.toLowerCase()
  if (category === 'sewing') return 'bg-sky-50 text-sky-700'
  if (category === 'amendment') return 'bg-rose-50 text-rose-700'
  if (category === 'laundry') return 'bg-emerald-50 text-emerald-700'
  return ''
}

function amendmentTaskName(task: AmendmentTask) {
  const taskType = Array.isArray(task.task_types) ? task.task_types[0] : task.task_types
  return taskType?.name || 'Task'
}

function amendmentCompletionStatus(tasks: AmendmentTask[]) {
  if (!tasks.length) return 'NO_TASKS'
  if (tasks.every(task => task.status === 'PAID')) return 'PAID'
  if (tasks.some(task => task.status === 'PAID')) return 'PARTIALLY_PAID'
  if (tasks.some(task => !['CREATED', 'QC_PASSED'].includes(task.status))) return 'LOCKED'
  if (tasks.every(task => task.status === 'CREATED')) return 'CREATED'
  if (tasks.every(task => task.status === 'QC_PASSED')) return 'QC_PASSED'
  return 'MIXED'
}

export default function RequestsClient({ userId, canEditAnyRequest }: { userId: string; canEditAnyRequest: boolean }) {
  const [view, setView] = useState<'browse' | 'requests'>('browse')
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [activeFilters, setActiveFilters] = useState<Filters>(initialFilters)
  const [requestFilters, setRequestFilters] = useState<RequestFilters>(initialRequestFilters)
  const [activeRequestFilters, setActiveRequestFilters] = useState<RequestFilters>(initialRequestFilters)
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])
  const [garments, setGarments] = useState<Garment[]>([])
  const [totalTickets, setTotalTickets] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingGarments, setLoadingGarments] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [requests, setRequests] = useState<ListedRequest[]>([])
  const [requestOffset, setRequestOffset] = useState(0)
  const [loadingRequests, setLoadingRequests] = useState(true)
  const [loadingMoreRequests, setLoadingMoreRequests] = useState(false)
  const [hasMoreRequests, setHasMoreRequests] = useState(false)
  const [editing, setEditing] = useState<FormState>(null)
  const [correctingRequest, setCorrectingRequest] = useState<ListedRequest | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [expandedRequests, setExpandedRequests] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [requestsError, setRequestsError] = useState('')
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null)
  const requestId = useRef(0)
  const requestLoadId = useRef(0)

  const fetchRequestPage = useCallback(async (offset: number): Promise<ListedRequest[]> => {
    const supabase = createClient()
    const hasItemFilters = Boolean(activeRequestFilters.ticketId || activeRequestFilters.customerName || activeRequestFilters.itemKey)
    let query = supabase.from('work_change_requests')
      .select(hasItemFilters ? filteredRequestSelect : requestSelect)
    if (activeRequestFilters.ticketId) query = query.ilike('items.tickets.ticket_number', `%${activeRequestFilters.ticketId.trim()}%`)
    if (activeRequestFilters.customerName) query = query.ilike('items.tickets.customer_name', `%${activeRequestFilters.customerName.trim()}%`)
    if (activeRequestFilters.itemKey) query = query.ilike('items.item_key', `%${activeRequestFilters.itemKey.trim()}%`)
    if (activeRequestFilters.kind) query = query.eq('kind', activeRequestFilters.kind)
    if (activeRequestFilters.status) query = query.eq('status', activeRequestFilters.status)
    if (activeRequestFilters.startDate) query = query.gte('created_at', new Date(`${activeRequestFilters.startDate}T00:00:00`).toISOString())
    if (activeRequestFilters.endDate) {
      const end = new Date(`${activeRequestFilters.endDate}T00:00:00`)
      end.setDate(end.getDate() + 1)
      query = query.lt('created_at', end.toISOString())
    }
    const { data, error: loadError } = await query.order('created_at', { ascending: false })
      .order('id', { ascending: false }).range(offset, offset + requestPageSize - 1)
    if (loadError) throw new Error(loadError.message)

    const rows = data || []
    if (!rows.length) return []
    const occurrenceIds = rows.filter(request => request.kind === 'AMENDMENT')
      .map(request => request.approved_snapshot?.amendment_occurrence_id).filter((id): id is string => Boolean(id))
    const [identities, profilesResult, assignmentsResult] = await Promise.all([
      db.getReplacementIdentityForItems(rows.map(request => request.item_id)),
      supabase.from('profiles').select('user_id, full_name, email')
        .in('user_id', [...new Set(rows.map(request => request.created_by))]),
      occurrenceIds.length
        ? supabase.from('work_assignments').select('id, amendment_occurrence_id, status, task_types(name)')
          .in('amendment_occurrence_id', occurrenceIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (profilesResult.error) throw new Error(profilesResult.error.message)
    if (assignmentsResult.error) throw new Error(assignmentsResult.error.message)
    const submitters = new Map((profilesResult.data || []).map(profile => [profile.user_id, profile.full_name || profile.email || 'Unknown']))
    const tasksByOccurrence = new Map<string, AmendmentTask[]>()
    for (const task of assignmentsResult.data || []) {
      if (!task.amendment_occurrence_id) continue
      const existing = tasksByOccurrence.get(task.amendment_occurrence_id) || []
      existing.push(task as AmendmentTask)
      tasksByOccurrence.set(task.amendment_occurrence_id, existing)
    }
    return rows.map(request => ({
      ...request,
      replacement_of_item_id: identities.get(request.item_id)?.replacement_of_item_id || null,
      replacement_origin_key: identities.get(request.item_id)?.replacement_origin_key || null,
      submitted_by: request.created_by === userId ? 'You' : submitters.get(request.created_by) || 'Unknown',
      amendment_tasks: tasksByOccurrence.get(request.approved_snapshot?.amendment_occurrence_id || '') || [],
    })) as ListedRequest[]
  }, [userId, activeRequestFilters])

  const loadRequests = useCallback(async () => {
    const current = ++requestLoadId.current
    setLoadingRequests(true)
    try {
      const rows = await fetchRequestPage(0)
      if (current !== requestLoadId.current) return
      setRequests(rows)
      setRequestOffset(rows.length)
      setHasMoreRequests(rows.length === requestPageSize)
      setRequestsError('')
    } catch (cause) {
      if (current === requestLoadId.current) setRequestsError(cause instanceof Error ? cause.message : 'Could not load requests.')
    } finally {
      if (current === requestLoadId.current) setLoadingRequests(false)
    }
  }, [fetchRequestPage])

  async function loadMoreRequests() {
    if (loadingRequests || loadingMoreRequests || !hasMoreRequests) return
    const current = requestLoadId.current
    setLoadingMoreRequests(true)
    try {
      const rows = await fetchRequestPage(requestOffset)
      if (current !== requestLoadId.current) return
      setRequests(current => [...current, ...rows.filter(row => !current.some(existing => existing.id === row.id))])
      setRequestOffset(current => current + rows.length)
      setHasMoreRequests(rows.length === requestPageSize)
      setRequestsError('')
    } catch (cause) {
      if (current === requestLoadId.current) setRequestsError(cause instanceof Error ? cause.message : 'Could not load more requests.')
    } finally {
      setLoadingMoreRequests(false)
    }
  }

  async function setRequestCompletion(request: ListedRequest, completed: boolean) {
    if (updatingRequestId) return
    const message = completed
      ? `Confirm all ${request.amendment_tasks.length} amendment tasks are complete? Accounts will be able to pay for them.`
      : 'Return this amendment to In progress? Its tasks will no longer be eligible for payment.'
    if (!window.confirm(message)) return
    setUpdatingRequestId(request.id)
    setRequestsError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.rpc('set_amendment_request_completion', {
      p_request_id: request.id, p_completed: completed,
    })
    if (updateError) {
      setRequestsError(updateError.message)
      setUpdatingRequestId(null)
      return
    }

    const status = completed ? 'QC_PASSED' : 'CREATED'
    setRequests(current => current.map(row => row.id === request.id
      ? { ...row, amendment_tasks: row.amendment_tasks.map(task => ({ ...task, status })) }
      : row))

    const occurrenceId = request.approved_snapshot?.amendment_occurrence_id
    if (occurrenceId) {
      const { data, error: refreshError } = await supabase.from('work_assignments')
        .select('id, status').eq('amendment_occurrence_id', occurrenceId)
      if (refreshError) {
        setRequestsError('Status changed, but task details could not be refreshed.')
      } else {
        const statuses = new Map((data || []).map(task => [task.id, task.status]))
        setRequests(current => current.map(row => row.id === request.id
          ? { ...row, amendment_tasks: row.amendment_tasks.map(task => ({ ...task, status: statuses.get(task.id) || task.status })) }
          : row))
      }
    }
    setUpdatingRequestId(null)
  }

  useEffect(() => {
    const timer = setTimeout(() => { void loadRequests() }, 0)
    return () => clearTimeout(timer)
  }, [loadRequests])

  useEffect(() => {
    let active = true
    void db.getProductTypes().then(rows => { if (active) setProducts(rows || []) })
      .catch(cause => { if (active) setError(cause.message || 'Could not load products.') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setActiveFilters(filters), 300)
    return () => clearTimeout(timer)
  }, [filters])

  useEffect(() => {
    const timer = setTimeout(() => setActiveRequestFilters(requestFilters), 300)
    return () => clearTimeout(timer)
  }, [requestFilters])

  useEffect(() => {
    const current = ++requestId.current
    const timer = setTimeout(async () => {
      setLoadingGarments(true)
      try {
        const result = await db.getTicketPaginatedItems(activeFilters, 1, pageSize)
        if (current === requestId.current) {
          setGarments(result.items || [])
          setTotalTickets(result.totalTickets)
          setPage(1)
          setError('')
        }
      } catch (cause) {
        if (current === requestId.current) setError(cause instanceof Error ? cause.message : 'Could not load tickets.')
      } finally {
        if (current === requestId.current) setLoadingGarments(false)
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [activeFilters])

  const grouped = useMemo(() => {
    const groups = new Map<string, { ticketNumber: string; customerName: string; items: Garment[] }>()
    for (const item of garments) {
      const key = item.ticket_id || item.ticket_number || item.id
      const group = groups.get(key) || { ticketNumber: item.ticket_number || 'Ticket', customerName: item.customer_name || 'Customer', items: [] }
      group.items.push(item)
      groups.set(key, group)
    }
    return [...groups.entries()]
  }, [garments])

  const groupedRequests = useMemo(() => {
    const groups = new Map<string, { ticketNumber: string; customerName: string; requests: ListedRequest[] }>()
    for (const request of requests) {
      const ticketNumber = request.items?.tickets?.ticket_number || '-'
      const customerName = request.items?.tickets?.customer_name || 'Customer'
      const key = ticketNumber === '-' ? request.item_id : ticketNumber
      const group = groups.get(key) || { ticketNumber, customerName, requests: [] }
      group.requests.push(request)
      groups.set(key, group)
    }
    return [...groups.entries()]
  }, [requests])

  async function loadMore() {
    if (loadingMore || page >= totalTickets / pageSize) return
    const current = requestId.current
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const result = await db.getTicketPaginatedItems(activeFilters, nextPage, pageSize)
      if (current === requestId.current) {
        setGarments(rows => [...rows, ...(result.items || [])])
        setPage(nextPage)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load more tickets.')
    } finally {
      setLoadingMore(false)
    }
  }

  function openRequest(item: Garment, kind: 'AMENDMENT' | 'REPLACEMENT') {
    setEditing({ item, kind })
  }

  const selectedRequest = editing && 'proposed_assignments' in editing ? editing : null
  const selectedGarment = editing && 'item' in editing ? editing.item : null
  const selectedKind = editing && 'kind' in editing ? editing.kind : undefined

  return <div className="space-y-6">
    <div><h1 className="font-serif text-2xl text-maison-primary">Consultants</h1><p className="text-sm text-maison-secondary">Find a ticket and submit an Amendment or Replacement request.</p></div>
    <div role="tablist" aria-label="Consultants views" className="flex flex-wrap gap-2">
      <button role="tab" aria-selected={view === 'browse'} type="button" onClick={() => { setView('browse'); setEditing(null) }} className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${view === 'browse' ? 'border-maison-primary bg-maison-primary text-white shadow-sm' : 'border-gray-200 bg-white text-maison-secondary hover:bg-gray-50'}`}>Tickets</button>
      <button role="tab" aria-selected={view === 'requests'} type="button" onClick={() => { setView('requests'); setEditing(null) }} className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${view === 'requests' ? 'border-maison-primary bg-maison-primary text-white shadow-sm' : 'border-gray-200 bg-white text-maison-secondary hover:bg-gray-50'}`}>Requests</button>
    </div>
    {view === 'browse' && error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {view === 'requests' && requestsError && <p role="alert" className="text-sm text-red-700">{requestsError}</p>}
    <Modal isOpen={Boolean(correctingRequest)} onClose={() => setCorrectingRequest(null)} title="Correct assignment" maxWidth="max-w-4xl" scrollable>
      {correctingRequest && <>
        <p className="mb-4 text-sm text-gray-600">Choose a task to correct its task or tailor. Give a reason and submit it for Customer Service review.</p>
        <GarmentHistory key={correctingRequest.id} itemId={correctingRequest.item_id} amendmentOccurrenceId={correctingRequest.approved_snapshot?.amendment_occurrence_id} />
      </>}
    </Modal>
    <Modal isOpen={Boolean(editing)} onClose={() => setEditing(null)} title="" maxWidth="max-w-4xl" scrollable>
      {editing && <RequestForm key={selectedRequest?.id || `${selectedGarment?.id}-${selectedKind}`} request={selectedRequest} selectedItem={selectedGarment} initialKind={selectedKind} inModal onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setView('requests'); void loadRequests() }} />}
    </Modal>
    {view === 'browse' && <>
      <div className="flex flex-wrap gap-2" aria-label="Garment status">
        {statuses.map(status => <button key={status.value} type="button" onClick={() => setFilters(value => ({ ...value, status: status.value }))} className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${filters.status === status.value ? 'border-maison-primary bg-maison-primary text-white shadow-sm' : 'border-gray-200 bg-white text-maison-secondary hover:bg-gray-50'}`}>{status.label}</button>)}
      </div>
      <Card>
        <div className="flex flex-col flex-wrap items-end gap-4 sm:flex-row">
          <label className="min-w-[150px] flex-1 text-xs font-semibold text-gray-500">Ticket ID
            <span className="relative mt-1 block"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" /><input value={filters.ticketId} onChange={event => setFilters(value => ({ ...value, ticketId: event.target.value }))} placeholder="Search ticket..." className="w-full rounded-md border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm" /></span>
          </label>
          <label className="min-w-[150px] flex-1 text-xs font-semibold text-gray-500">Customer
            <input value={filters.customerName} onChange={event => setFilters(value => ({ ...value, customerName: event.target.value }))} placeholder="Search customer..." className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="w-full min-w-[150px] sm:w-auto text-xs font-semibold text-gray-500">Product Type
            <select value={filters.productType} onChange={event => setFilters(value => ({ ...value, productType: event.target.value }))} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"><option value="">All Products</option>{products.map(product => <option key={product.id} value={product.name}>{product.name}</option>)}</select>
          </label>
          <div className="w-full sm:w-auto"><span className="mb-1 block text-xs font-semibold text-gray-500">Date Range</span><div className="grid grid-cols-2 gap-2"><input aria-label="Start date" type="date" value={filters.startDate} onChange={event => setFilters(value => ({ ...value, startDate: event.target.value }))} className="min-w-0 w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-sm" /><input aria-label="End date" type="date" value={filters.endDate} onChange={event => setFilters(value => ({ ...value, endDate: event.target.value }))} className="min-w-0 w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-sm" /></div></div>
          <Button type="button" variant="ghost" title="Clear filters" aria-label="Clear filters" onClick={() => setFilters(initialFilters)} className="bg-gray-50 px-3" isLoading={false} disabled={false}><FilterX className="h-4 w-4" /></Button>
        </div>
      </Card>
      {loadingGarments && <Card><p className="py-10 text-center text-sm text-gray-500">Loading tickets...</p></Card>}
      {!loadingGarments && garments.length === 0 && <Card><p className="py-10 text-center text-sm text-gray-500">No tickets match these filters.</p></Card>}
      {!loadingGarments && <div className="space-y-4">
        {grouped.map(([key, group]) => {
          const isExpanded = expanded[key] ?? true
          return <Card key={key} padding="p-0" className="overflow-hidden border border-gray-200">
            <button type="button" aria-expanded={isExpanded} onClick={() => setExpanded(value => ({ ...value, [key]: !isExpanded }))} className="flex w-full flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-3 text-left hover:bg-gray-100">
              {isExpanded ? <ChevronDown className="h-5 w-5 shrink-0" /> : <ChevronRight className="h-5 w-5 shrink-0" />}
              <span className="min-w-0 flex-1 font-serif text-lg font-medium text-maison-primary">{group.customerName}</span>
              <span className="hidden text-gray-300 sm:inline">|</span>
              <span className="font-mono text-sm text-gray-500">{group.ticketNumber}</span>
              <span className="ml-auto text-sm text-maison-secondary">{group.items.length} {group.items.length === 1 ? 'Product' : 'Products'} Total</span>
            </button>
            {isExpanded && <Table headers={['Item Key', 'Product', 'Categories', 'Status', 'Date', 'Actions']} className="" tableClassName="">
              {group.items.map(item => {
                const eligible = !['ARCHIVED', 'CANCELLED'].includes(item.raw_status || item.status)
                const categories = [...new Set((item.work_assignments || []).map(assignment => assignment.category_types?.name).filter(Boolean))]
                const hasAmendment = categories.some(name => name?.toLowerCase() === 'amendment')
                return <TableRow key={item.id} className="" onClick={undefined}>
                  <TableCell className="font-mono text-xs font-medium"><span className="block">{item.item_key || '-'}</span>{item.replacement_of_item_id && <ReplacementTag originalItemKey={item.replacement_origin_key} className="mt-1" />}</TableCell>
                  <TableCell className="">{item.product_type_name || '-'}</TableCell>
                  <TableCell className="whitespace-normal"><div className="flex flex-wrap gap-1">{categories.length ? categories.map(name => <Badge key={name} variant="neutral" className={categoryBadgeClass(name || '')}>{name}</Badge>) : <span className="text-gray-300">-</span>}</div></TableCell>
                  <TableCell className=""><Badge className="" variant={item.status === 'ARCHIVED' ? 'neutral' : item.status === 'CANCELLED' ? 'danger' : item.status === 'NEW' ? 'warning' : item.status === 'IN_PRODUCTION' ? 'brand' : 'success'}>{item.status === 'OUT_OF_PRODUCTION' ? 'Out of Production' : item.status === 'IN_PRODUCTION' ? 'In Production' : item.status === 'NEW' ? 'New' : item.status}</Badge></TableCell>
                  <TableCell className="text-sm text-gray-500">{item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy') : '-'}</TableCell>
                  <TableCell className=""><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" className="" title={hasAmendment ? 'Further amendments are on hold' : undefined} isLoading={false} disabled={!eligible || hasAmendment} onClick={() => openRequest(item, 'AMENDMENT')}>Amendment</Button><Button type="button" size="sm" variant="secondary" className="" isLoading={false} disabled={!eligible} onClick={() => openRequest(item, 'REPLACEMENT')}>Replacement</Button></div></TableCell>
                </TableRow>
              })}
            </Table>}
          </Card>
        })}
      </div>}
      {!loadingGarments && page * pageSize < totalTickets && <div className="flex justify-center py-4"><Button type="button" variant="secondary" className="" disabled={loadingMore} isLoading={loadingMore} onClick={() => void loadMore()}>Load More</Button></div>}
    </>}
    {view === 'requests' && <>
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <label className="min-w-[145px] flex-1 text-xs font-semibold text-gray-500">Ticket ID
            <span className="relative mt-1 block"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" /><input value={requestFilters.ticketId} onChange={event => setRequestFilters(value => ({ ...value, ticketId: event.target.value }))} placeholder="Search ticket..." className="w-full rounded-md border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm" /></span>
          </label>
          <label className="min-w-[145px] flex-1 text-xs font-semibold text-gray-500">Customer
            <input value={requestFilters.customerName} onChange={event => setRequestFilters(value => ({ ...value, customerName: event.target.value }))} placeholder="Search customer..." className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="min-w-[145px] flex-1 text-xs font-semibold text-gray-500">Item Key
            <input value={requestFilters.itemKey} onChange={event => setRequestFilters(value => ({ ...value, itemKey: event.target.value }))} placeholder="Search item..." className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="min-w-[145px] flex-1 text-xs font-semibold text-gray-500">Type
            <select value={requestFilters.kind} onChange={event => setRequestFilters(value => ({ ...value, kind: event.target.value }))} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"><option value="">All types</option><option value="AMENDMENT">Amendment</option><option value="REPLACEMENT">Replacement</option></select>
          </label>
          <label className="min-w-[145px] flex-1 text-xs font-semibold text-gray-500">Status
            <select value={requestFilters.status} onChange={event => setRequestFilters(value => ({ ...value, status: event.target.value }))} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"><option value="">All statuses</option><option value="PENDING">Pending</option><option value="APPROVED">Assigned / Approved</option><option value="REJECTED">Rejected</option></select>
          </label>
          <div className="min-w-[240px] flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">Submitted Date</span><div className="grid grid-cols-2 gap-2"><input aria-label="Submitted from" type="date" value={requestFilters.startDate} onChange={event => setRequestFilters(value => ({ ...value, startDate: event.target.value }))} className="min-w-0 w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-sm" /><input aria-label="Submitted to" type="date" value={requestFilters.endDate} onChange={event => setRequestFilters(value => ({ ...value, endDate: event.target.value }))} className="min-w-0 w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-sm" /></div></div>
          <Button type="button" variant="ghost" title="Clear request filters" aria-label="Clear request filters" onClick={() => setRequestFilters(initialRequestFilters)} className="bg-gray-50 px-3" isLoading={false} disabled={false}><FilterX className="h-4 w-4" /></Button>
        </div>
      </Card>
      {loadingRequests && <Card><p className="py-10 text-center text-sm text-gray-500">Loading requests...</p></Card>}
      {!loadingRequests && requests.length === 0 && <Card><p className="py-10 text-center text-sm text-gray-500">No requests match these filters.</p></Card>}
      {!loadingRequests && requests.length > 0 && <div className="space-y-4">
        {groupedRequests.map(([key, group]) => {
          const isExpanded = expandedRequests[key] ?? true
          return <Card key={key} padding="p-0" className="overflow-hidden border border-gray-200">
            <button type="button" aria-expanded={isExpanded} onClick={() => setExpandedRequests(value => ({ ...value, [key]: !isExpanded }))} className="flex w-full flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-3 text-left hover:bg-gray-100">
              {isExpanded ? <ChevronDown className="h-5 w-5 shrink-0" /> : <ChevronRight className="h-5 w-5 shrink-0" />}
              <span className="min-w-0 flex-1 font-serif text-lg font-medium text-maison-primary">{group.customerName}</span>
              <span className="hidden text-gray-300 sm:inline">|</span>
              <span className="font-mono text-sm text-gray-500">{group.ticketNumber}</span>
              <span className="ml-auto text-sm text-maison-secondary">{group.requests.length} {group.requests.length === 1 ? 'Request' : 'Requests'} Total</span>
            </button>
            {isExpanded && <Table headers={['Item', 'Type', 'Note / Task', 'Submitted by', 'Submitted', 'Status', 'Actions']} className="" tableClassName="">
              {group.requests.map(request => {
                const completionStatus = amendmentCompletionStatus(request.amendment_tasks)
                const canUpdateCompletion = request.kind === 'AMENDMENT' && request.status === 'APPROVED' && ['CREATED', 'QC_PASSED', 'MIXED'].includes(completionStatus)
                return <TableRow key={request.id} className="" onClick={undefined}>
                  <TableCell className="font-mono text-xs"><span className="block">{request.items?.item_key || '-'}</span>{request.replacement_of_item_id && <ReplacementTag originalItemKey={request.replacement_origin_key} className="mt-1" />}</TableCell>
                  <TableCell className=""><Badge className="" variant={request.kind === 'AMENDMENT' ? 'warning' : 'brand'}>{request.kind === 'AMENDMENT' ? amendmentLabel(request.amendment_ordinal) : 'Replacement'}</Badge></TableCell>
                  <TableCell className=""><div className="max-w-xs whitespace-normal text-gray-700">{request.note}{request.review_reason && <p className="mt-1 text-xs text-red-700">Rejected: {request.review_reason}</p>}{request.kind === 'AMENDMENT' && request.status === 'APPROVED' && request.amendment_tasks.length > 0 && <p className="mt-1 text-xs text-gray-500">{request.amendment_tasks.map(amendmentTaskName).join(', ')}</p>}</div></TableCell>
                  <TableCell className="text-gray-600">{request.submitted_by}</TableCell>
                  <TableCell className="text-gray-500">{format(new Date(request.created_at), 'MMM d, yyyy')}</TableCell>
                  <TableCell className="">
                    {request.kind === 'AMENDMENT' && request.status === 'APPROVED' ? <span className="relative block w-[190px]">
                      <select
                        aria-label={`${request.items?.item_key || 'Item'} amendment status`}
                        value={completionStatus}
                        disabled={Boolean(updatingRequestId) || !canUpdateCompletion}
                        onChange={event => void setRequestCompletion(request, event.target.value === 'QC_PASSED')}
                        className={`h-9 w-full appearance-none rounded-lg border px-3 pr-8 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-maison-primary/20 disabled:cursor-not-allowed disabled:opacity-70 ${completionStatus === 'CREATED' ? 'border-sky-200 bg-sky-50 text-sky-800' : completionStatus === 'QC_PASSED' || completionStatus === 'PAID' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-600'}`}
                      >
                        <option value="CREATED">In progress</option>
                        <option value="QC_PASSED">Completed</option>
                        {completionStatus === 'MIXED' && <option value="MIXED">Partly completed</option>}
                        {completionStatus === 'PAID' && <option value="PAID">Paid</option>}
                        {completionStatus === 'PARTIALLY_PAID' && <option value="PARTIALLY_PAID">Partly paid</option>}
                        {completionStatus === 'LOCKED' && <option value="LOCKED">Unavailable</option>}
                        {completionStatus === 'NO_TASKS' && <option value="NO_TASKS">No linked tasks</option>}
                      </select>
                      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
                    </span> : <Badge className="" variant={request.status === 'APPROVED' ? 'success' : request.status === 'REJECTED' ? 'danger' : 'warning'}>{request.status === 'PENDING' ? 'Pending' : request.status === 'REJECTED' ? 'Rejected' : 'Approved'}</Badge>}
                  </TableCell>
                  <TableCell className="">
                    {request.kind === 'AMENDMENT' && request.status === 'APPROVED' && completionStatus === 'CREATED' && request.approved_snapshot?.amendment_occurrence_id && <button type="button" disabled={Boolean(updatingRequestId)} onClick={() => setCorrectingRequest(request)} className="text-sm text-maison-primary underline disabled:opacity-50">Correct assignment</button>}
                    {request.kind === 'AMENDMENT' && request.status === 'APPROVED' && ['QC_PASSED', 'MIXED'].includes(completionStatus) && <span className="text-xs text-gray-500">Return to In progress to correct an assignment.</span>}
                    {request.status === 'PENDING' && (request.created_by === userId || canEditAnyRequest) && <button type="button" onClick={() => setEditing(request)} aria-label={`Edit request for ${request.items?.item_key || 'item'}`} title="Edit request" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-maison-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-maison-primary"><Pencil className="h-4 w-4" /></button>}
                  </TableCell>
                </TableRow>
              })}
            </Table>}
          </Card>
        })}
      </div>}
      {!loadingRequests && hasMoreRequests && <div className="flex justify-center py-4"><Button type="button" variant="secondary" className="" disabled={loadingMoreRequests} isLoading={loadingMoreRequests} onClick={() => void loadMoreRequests()}>Load More</Button></div>}
    </>}
  </div>
}
