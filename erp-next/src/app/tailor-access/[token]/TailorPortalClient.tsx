// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
'use client'

import Image from 'next/image'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Banknote, BriefcaseBusiness, CheckCircle2, ChevronLeft, ChevronRight, LockKeyhole, LogOut } from 'lucide-react'
import { db } from '@/services/db'
import { formatMoney } from '@/lib/formatters'

const PAGE_SIZE = 25

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
]

function statusDetails(status: string) {
  const details = {
    CREATED: { label: 'Assigned', className: 'bg-gray-100 text-gray-700' },
    QC_PASSED: { label: 'Approved', className: 'bg-emerald-50 text-emerald-700' },
    PAID: { label: 'Paid', className: 'bg-blue-50 text-blue-700' },
    QC_FAILED: { label: 'Rejected', className: 'bg-red-50 text-red-700' },
    REVERSED: { label: 'Reversed', className: 'bg-amber-50 text-amber-700' },
  }

  return details[status] || { label: status || 'Unknown', className: 'bg-gray-100 text-gray-700' }
}

function SummaryCard({ icon: Icon, label, value, helper }: { icon: React.ElementType, label: string, value: string, helper: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-700">
          <Icon size={19} />
        </div>
        <span className="text-sm font-medium text-maison-secondary">{label}</span>
      </div>
      <div className="mt-5 text-2xl font-medium text-maison-primary">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{helper}</div>
    </div>
  )
}

export default function TailorPortalClient({ accessToken }: { accessToken: string }) {
  const storageKey = useMemo(() => `tailor-portal-session:${accessToken}`, [accessToken])
  const [initialized, setInitialized] = useState(false)
  const [sessionToken, setSessionToken] = useState('')
  const [pin, setPin] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [portalData, setPortalData] = useState(null)
  const [status, setStatus] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const savedSession = window.sessionStorage.getItem(storageKey)
    if (savedSession) setSessionToken(savedSession)
    setInitialized(true)
  }, [storageKey])

  const clearSession = useCallback((message = '') => {
    window.sessionStorage.removeItem(storageKey)
    setSessionToken('')
    setPortalData(null)
    setPin('')
    setError(message)
  }, [storageKey])

  const loadWork = useCallback(async () => {
    if (!sessionToken) return

    setLoading(true)
    setError('')

    try {
      const result = await db.getTailorPortalWork(sessionToken, {
        status,
        startDate,
        endDate,
      }, page, PAGE_SIZE)

      if (result?.error_code === 'SESSION_EXPIRED') {
        clearSession('Your access session has expired. Enter your PIN again.')
        return
      }

      setPortalData(result)
    } catch (loadError) {
      setError(loadError.message || 'Unable to load your work history.')
    } finally {
      setLoading(false)
    }
  }, [clearSession, endDate, page, sessionToken, startDate, status])

  useEffect(() => {
    if (initialized && sessionToken) loadWork()
  }, [initialized, loadWork, sessionToken])

  const handleAuthenticate = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^\d{6}$/.test(pin)) {
      setError('Enter the six-digit PIN that was shared with you.')
      return
    }

    setAuthLoading(true)
    setError('')

    try {
      const result = await db.authenticateTailorPortal(accessToken, pin)

      if (result.error_code === 'LOCKED') {
        setError('Too many incorrect attempts. Try again in 15 minutes or contact an administrator.')
        return
      }

      if (result.error_code || !result.session_token) {
        setError('The link or PIN is incorrect. Check both values and try again.')
        return
      }

      window.sessionStorage.setItem(storageKey, result.session_token)
      setSessionToken(result.session_token)
      setPin('')
    } catch (authError) {
      setError(authError.message || 'Unable to verify this access link.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleStatusChange = (nextStatus: string) => {
    setStatus(nextStatus)
    setPage(1)
  }

  const handleDateChange = (setter: (value: string) => void, value: string) => {
    setter(value)
    setPage(1)
  }

  if (!initialized) {
    return <div className="min-h-screen bg-[#f6f8fb]" />
  }

  if (!sessionToken) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f8fb] px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <Image src="/logo.png" alt="Deji and Kola" width={88} height={72} className="mx-auto h-16 w-auto object-contain" priority />
            <h1 className="mt-4 text-2xl font-medium text-maison-primary">My Work & Pay</h1>
            <p className="mt-2 text-sm text-maison-secondary">Enter your private six-digit PIN to continue.</p>
          </div>

          <form onSubmit={handleAuthenticate} className="rounded-lg border border-gray-100 bg-white p-6 shadow-sm">
            {error && (
              <div className="mb-5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <label htmlFor="tailor-pin" className="block text-sm font-medium text-maison-secondary">Access PIN</label>
            <div className="relative mt-2">
              <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                id="tailor-pin"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className="w-full rounded-lg border border-gray-200 py-3 pl-11 pr-4 text-center font-mono text-xl tracking-[0.3em] outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                autoFocus
                required
              />
            </div>

            <button
              type="submit"
              disabled={authLoading || pin.length !== 6}
              className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-maison-primary px-4 py-3 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {authLoading ? 'Checking...' : 'View My Work'}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-gray-500">This page is read-only. Contact an administrator if you need a new link or PIN.</p>
        </div>
      </main>
    )
  }

  const summary = portalData?.summary || {}
  const entries = portalData?.entries || []
  const totalCount = Number(portalData?.total_count || 0)
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageStart = totalCount === 0 ? 0 : ((page - 1) * PAGE_SIZE) + 1
  const pageEnd = Math.min(page * PAGE_SIZE, totalCount)

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-maison-primary">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Image src="/logo.png" alt="Deji and Kola" width={68} height={56} className="h-12 w-auto object-contain" priority />
            <div>
              <h1 className="text-xl font-medium">{portalData?.tailor?.name || 'My Work & Pay'}</h1>
              <p className="mt-0.5 text-sm text-maison-secondary">{portalData?.tailor?.department || 'Tailor work statement'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => clearSession()}
            className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-maison-secondary shadow-sm transition hover:text-maison-primary sm:self-auto"
          >
            <LogOut size={16} /> Lock Page
          </button>
        </header>

        {error && (
          <div className="mt-5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            icon={Banknote}
            label="Total Earned"
            value={formatMoney(summary.earned_total, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            helper="Approved and paid work"
          />
          <SummaryCard
            icon={CheckCircle2}
            label="Approved"
            value={formatMoney(summary.approved_total, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            helper="Approved, awaiting payment"
          />
          <SummaryCard
            icon={BriefcaseBusiness}
            label="Paid"
            value={formatMoney(summary.paid_total, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            helper="Recorded as paid"
          />
        </section>

        <section className="mt-6 rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap gap-2" aria-label="Work status filter">
              {STATUS_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleStatusChange(option.value)}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${status === option.value ? 'border-maison-primary bg-maison-primary text-white' : 'border-gray-200 bg-white text-maison-secondary hover:bg-gray-50'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-gray-500">
                From
                <input
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(event) => handleDateChange(setStartDate, event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-maison-primary"
                />
              </label>
              <label className="text-xs font-medium text-gray-500">
                To
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(event) => handleDateChange(setEndDate, event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-maison-primary"
                />
              </label>
            </div>
          </div>
        </section>

        <section className="mt-5 space-y-3" aria-live="polite">
          {loading && !portalData ? (
            <div className="rounded-lg border border-gray-100 bg-white px-5 py-12 text-center text-sm text-gray-500 shadow-sm">Loading your work...</div>
          ) : entries.length > 0 ? entries.map(entry => {
            const entryStatus = statusDetails(entry.status)
            return (
              <article key={entry.id} className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium text-maison-primary">{entry.task_name || 'Production task'}</h2>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${entryStatus.className}`}>{entryStatus.label}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-maison-secondary">
                      <span>{entry.category_name || 'Uncategorized'}</span>
                      <span>Reference: {entry.item_reference || 'Not available'}</span>
                      <span>{entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : 'Date unavailable'}</span>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="text-lg font-medium text-maison-primary">
                      {formatMoney(entry.pay_amount, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">Payment amount</div>
                  </div>
                </div>
              </article>
            )
          }) : (
            <div className="rounded-lg border border-gray-100 bg-white px-5 py-12 text-center shadow-sm">
              <div className="text-sm font-medium text-maison-primary">No work found</div>
              <div className="mt-1 text-sm text-gray-500">Try another status or date range.</div>
            </div>
          )}
        </section>

        <footer className="mt-5 flex flex-col gap-3 pb-8 text-sm text-maison-secondary sm:flex-row sm:items-center sm:justify-between">
          <span>{pageStart}-{pageEnd} of {totalCount} tasks</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(current => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm disabled:opacity-40"
            >
              <ChevronLeft size={16} /> Previous
            </button>
            <span className="px-2">Page {page} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage(current => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages || loading}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm disabled:opacity-40"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </footer>
      </div>
    </main>
  )
}
