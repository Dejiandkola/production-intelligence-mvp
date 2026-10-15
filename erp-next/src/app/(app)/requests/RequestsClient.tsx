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
import GarmentHistory from '@/components/Requests/GarmentHistory'
import type { WorkRequest } from '@/components/Requests/types'
import { amendmentLabel } from '@/lib/amendment-label'
import ReplacementTag from '@/components/Requests/ReplacementTag'

type Garment = ItemOption & { ticket_id: string; created_at?: string; replacement_of_item_id?: string | null; replacement_origin_key?: string | null; work_assignments?: { category_types?: { name?: string } }[] }
type FormState = { item: Garment; kind: 'AMENDMENT' | 'REPLACEMENT' } | WorkRequest | null
type Filters = { ticketId: string; customerName: string; productType: string; status: string; startDate: string; endDate: string }

const pageSize = 20
const requestSelect = '*, items!work_change_requests_item_id_fkey(item_key, status, product_type_id, tickets(ticket_number, customer_name), product_types(name))'
const initialFilters: Filters = { ticketId: '', customerName: '', productType: '', status: '', startDate: '', endDate: '' }
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

export default function RequestsClient({ userId }: { userId: string }) {
  const [view, setView] = useState<'browse' | 'mine'>('browse')
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [activeFilters, setActiveFilters] = useState<Filters>(initialFilters)
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])
  const [garments, setGarments] = useState<Garment[]>([])
  const [totalTickets, setTotalTickets] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingGarments, setLoadingGarments] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [requests, setRequests] = useState<WorkRequest[]>([])
  const [loadingRequests, setLoadingRequests] = useState(true)
  const [editing, setEditing] = useState<FormState>(null)
  const [historyItemId, setHistoryItemId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [requestsError, setRequestsError] = useState('')
  const requestId = useRef(0)

  const loadRequests = useCallback(async () => {
    setLoadingRequests(true)
    const { data, error: loadError } = await createClient().from('work_change_requests')
      .select(requestSelect).eq('created_by', userId).order('created_at', { ascending: false }).limit(100)
    if (loadError) setRequestsError(loadError.message)
    else {
      try {
        const identities = await db.getReplacementIdentityForItems((data || []).map(request => request.item_id))
        setRequests((data || []).map(request => ({ ...request, replacement_of_item_id: identities.get(request.item_id)?.replacement_of_item_id || null, replacement_origin_key: identities.get(request.item_id)?.replacement_origin_key || null })) as WorkRequest[])
        setRequestsError('')
      } catch (cause) {
        setRequestsError(cause instanceof Error ? cause.message : 'Could not load replacement references.')
      }
    }
    setLoadingRequests(false)
  }, [userId])

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
      <button role="tab" aria-selected={view === 'mine'} type="button" onClick={() => { setView('mine'); setEditing(null) }} className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${view === 'mine' ? 'border-maison-primary bg-maison-primary text-white shadow-sm' : 'border-gray-200 bg-white text-maison-secondary hover:bg-gray-50'}`}>Requests</button>
    </div>
    {view === 'browse' && error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {view === 'mine' && requestsError && <p role="alert" className="text-sm text-red-700">{requestsError}</p>}
    <Modal isOpen={Boolean(editing)} onClose={() => setEditing(null)} title="" maxWidth="max-w-4xl" scrollable>
      {editing && <RequestForm key={selectedRequest?.id || `${selectedGarment?.id}-${selectedKind}`} request={selectedRequest} selectedItem={selectedGarment} initialKind={selectedKind} inModal onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void loadRequests() }} />}
    </Modal>
    <Modal isOpen={Boolean(historyItemId)} onClose={() => setHistoryItemId(null)} title="Garment History" maxWidth="max-w-4xl" scrollable>
      {historyItemId && <GarmentHistory key={historyItemId} itemId={historyItemId} />}
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
                return <TableRow key={item.id} className="" onClick={undefined}>
                  <TableCell className="font-mono text-xs font-medium"><span className="block">{item.item_key || '-'}</span>{item.replacement_of_item_id && <ReplacementTag originalItemKey={item.replacement_origin_key} className="mt-1" />}</TableCell>
                  <TableCell className="">{item.product_type_name || '-'}</TableCell>
                  <TableCell className="whitespace-normal"><div className="flex flex-wrap gap-1">{categories.length ? categories.map(name => <Badge key={name} variant="neutral" className={categoryBadgeClass(name || '')}>{name}</Badge>) : <span className="text-gray-300">-</span>}</div></TableCell>
                  <TableCell className=""><Badge className="" variant={item.status === 'ARCHIVED' ? 'neutral' : item.status === 'CANCELLED' ? 'danger' : item.status === 'NEW' ? 'warning' : item.status === 'IN_PRODUCTION' ? 'brand' : 'success'}>{item.status === 'OUT_OF_PRODUCTION' ? 'Out of Production' : item.status === 'IN_PRODUCTION' ? 'In Production' : item.status === 'NEW' ? 'New' : item.status}</Badge></TableCell>
                  <TableCell className="text-sm text-gray-500">{item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy') : '-'}</TableCell>
                  <TableCell className=""><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" className="" isLoading={false} disabled={false} onClick={() => setHistoryItemId(item.id)}>History</Button><Button type="button" size="sm" variant="secondary" className="" isLoading={false} disabled={!eligible} onClick={() => openRequest(item, 'AMENDMENT')}>Amendment</Button><Button type="button" size="sm" variant="secondary" className="" isLoading={false} disabled={!eligible} onClick={() => openRequest(item, 'REPLACEMENT')}>Replacement</Button></div></TableCell>
                </TableRow>
              })}
            </Table>}
          </Card>
        })}
      </div>}
      {!loadingGarments && page * pageSize < totalTickets && <div className="flex justify-center py-4"><Button type="button" variant="secondary" className="" disabled={loadingMore} isLoading={loadingMore} onClick={() => void loadMore()}>Load More</Button></div>}
    </>}
    {view === 'mine' && <>
      {loadingRequests && <Card><p className="py-10 text-center text-sm text-gray-500">Loading requests...</p></Card>}
      {!loadingRequests && requests.length === 0 && <Card><p className="py-10 text-center text-sm text-gray-500">No requests yet.</p></Card>}
      {requests.length > 0 && <Table headers={['Ticket', 'Customer', 'Item', 'Type', 'Note', 'Submitted', 'Status', 'Actions']} className="" tableClassName="">
        {requests.map(request => <TableRow key={request.id} className="" onClick={undefined}>
          <TableCell className="font-mono text-xs">{request.items?.tickets?.ticket_number || '-'}</TableCell>
          <TableCell className="font-medium">{request.items?.tickets?.customer_name || '-'}</TableCell>
          <TableCell className="font-mono text-xs"><span className="block">{request.items?.item_key || '-'}</span>{request.replacement_of_item_id && <ReplacementTag originalItemKey={request.replacement_origin_key} className="mt-1" />}</TableCell>
          <TableCell className=""><Badge className="" variant={request.kind === 'AMENDMENT' ? 'warning' : 'brand'}>{request.kind === 'AMENDMENT' ? amendmentLabel(request.amendment_ordinal) : 'Replacement'}</Badge></TableCell>
          <TableCell className=""><div className="max-w-xs whitespace-normal text-gray-700">{request.note}{request.review_reason && <p className="mt-1 text-xs text-red-700">Rejected: {request.review_reason}</p>}</div></TableCell>
          <TableCell className="text-gray-500">{format(new Date(request.created_at), 'MMM d, yyyy')}</TableCell>
          <TableCell className=""><Badge className="" variant={request.status === 'APPROVED' ? 'success' : request.status === 'REJECTED' ? 'danger' : 'warning'}>{request.status === 'PENDING' ? 'Pending' : request.status === 'APPROVED' ? 'Approved' : 'Rejected'}</Badge></TableCell>
          <TableCell className="">{request.status === 'PENDING' && <button type="button" onClick={() => setEditing(request)} aria-label={`Edit request for ${request.items?.item_key || 'item'}`} title="Edit request" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-maison-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-maison-primary"><Pencil className="h-4 w-4" /></button>}</TableCell>
        </TableRow>)}
      </Table>}
    </>}
  </div>
}
