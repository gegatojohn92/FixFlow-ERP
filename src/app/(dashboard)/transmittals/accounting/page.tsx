'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  disburseCashAndMarkSent,
  verifyCashAndMarkReceived,
} from '@/lib/actions/transmittal-actions'
import { createBrowserClient } from '@/lib/supabase/client'
import { useActionLock } from '@/components/ui/ActionLock'
import { clearAllCache } from '@/lib/cache/query-cache'
import Link from 'next/link'
import {
  PG_UNDEFINED_COLUMN,
  SPARE_CHANGE_TOLERANCE,
  outstandingSpareChange,
  isDeliveryVerified,
} from '@/lib/status-machines'
import {
  Banknote,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Send,
  ArrowDownCircle,
  Clock,
  DollarSign,
} from 'lucide-react'

interface TransmittalRow {
  id: number
  transmittal_number: string
  transmittal_type: string
  amount: number
  sender_status: string
  receiver_status: string
  sent_at: string | null
  received_at: string | null
  notes: string | null
  batch_code: string | null
  mrs_id: number | null
  created_at: string | null
  sender: { full_name: string; role: string } | null
  receiver: { full_name: string; role: string } | null
  mrs: {
    mrs_number: string
    overall_status: string
    requester_verification: string | null
    spare_change_required: number | null
    spare_change_returned: number | null
  } | null
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-900/30 text-amber-400 border-amber-800/50',
  SENT: 'bg-blue-900/30 text-blue-400 border-blue-800/50',
  RECEIVED: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/50',
  CANCELLED: 'bg-red-900/30 text-red-400 border-red-800/50',
}

export default function AccountingTransmittalPage() {
  const supabase = createBrowserClient()
  const { runLocked, isLocked } = useActionLock()

  const [transmittals, setTransmittals] = useState<TransmittalRow[]>([])
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [spareChangeInputs, setSpareChangeInputs] = useState<Record<number, string>>({})
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'SENT' | 'RECEIVED'>('ALL')
  // True when migration 0013 has not been applied to this Supabase project.
  const [migrationPending, setMigrationPending] = useState(false)

  const loadTransmittals = useCallback(async () => {
    // Use separate queries to join sender and receiver manually
    const { data } = await supabase
      .from('transmittal_forms')
      .select('*')
      .order('created_at', { ascending: false })

    if (!data) {
      setTransmittals([])
      return
    }

    // Collect all user IDs and mrs IDs for batch lookup
    const userIds = new Set<string>()
    const mrsIds = new Set<number>()
    for (const row of data) {
      if (row.sender_user_id) userIds.add(row.sender_user_id)
      if (row.receiver_user_id) userIds.add(row.receiver_user_id)
      if (row.mrs_id) mrsIds.add(row.mrs_id)
    }

    // Fetch users
    const { data: users } = userIds.size > 0
      ? await supabase.from('users').select('id, full_name, role').in('id', Array.from(userIds))
      : { data: [] }

    const userMap = new Map((users || []).map(u => [u.id, u]))

    // Fetch MRS.
    //
    // The 0013 spare-change columns only exist once that migration has been
    // applied. PostgREST fails the ENTIRE query with 42703 on an unknown
    // column (agent_handoff Rule 7), which would blank the whole Accounting
    // queue — so fall back to the pre-0013 column set and use safe defaults.
    type MRSRow = {
      id: number
      mrs_number: string
      overall_status: string
      requester_verification?: string | null
      spare_change_required?: number | null
      spare_change_returned?: number | null
    }

    let mrsList: MRSRow[] = []
    if (mrsIds.size > 0) {
      const ids = Array.from(mrsIds)
      const withGate = await supabase
        .from('material_requisitions')
        .select(
          'id, mrs_number, overall_status, requester_verification, spare_change_required, spare_change_returned'
        )
        .in('id', ids)

      if (withGate.error?.code === PG_UNDEFINED_COLUMN) {
        setMigrationPending(true)
        const legacy = await supabase
          .from('material_requisitions')
          .select('id, mrs_number, overall_status, requester_verification')
          .in('id', ids)
        mrsList = (legacy.data as MRSRow[]) || []
      } else {
        mrsList = (withGate.data as MRSRow[]) || []
      }
    }

    const mrsMap = new Map(mrsList.map(m => [m.id, m]))

    const enriched: TransmittalRow[] = data.map(row => ({
      id: row.id,
      transmittal_number: row.transmittal_number,
      transmittal_type: row.transmittal_type,
      amount: row.amount,
      sender_status: row.sender_status,
      receiver_status: row.receiver_status,
      sent_at: row.sent_at,
      received_at: row.received_at,
      notes: row.notes,
      batch_code: row.batch_code,
      mrs_id: row.mrs_id,
      created_at: row.created_at,
      sender: userMap.get(row.sender_user_id) ? { full_name: userMap.get(row.sender_user_id)!.full_name, role: userMap.get(row.sender_user_id)!.role } : null,
      receiver: userMap.get(row.receiver_user_id) ? { full_name: userMap.get(row.receiver_user_id)!.full_name, role: userMap.get(row.receiver_user_id)!.role } : null,
      mrs: row.mrs_id && mrsMap.get(row.mrs_id)
        ? {
            mrs_number: mrsMap.get(row.mrs_id)!.mrs_number,
            overall_status: mrsMap.get(row.mrs_id)!.overall_status,
            requester_verification: mrsMap.get(row.mrs_id)!.requester_verification ?? 'PENDING_DELIVERY',
            spare_change_required: mrsMap.get(row.mrs_id)!.spare_change_required ?? 0,
            spare_change_returned: mrsMap.get(row.mrs_id)!.spare_change_returned ?? 0,
          }
        : null,
    }))

    setTransmittals(enriched)
  }, [supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTransmittals()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadTransmittals])

  async function handleDisburse(trId: number) {
    // Guarded globally: a double-click here would move real cash twice.
    await runLocked('Disbursing cash & marking SENT…', async () => {
      setLoadingId(trId)
      setFeedback(null)
      try {
        const result = await disburseCashAndMarkSent(trId)
        if (!result.success) {
          setFeedback({ type: 'error', message: result.error })
          await loadTransmittals()
          return
        }
        setFeedback({ type: 'success', message: 'Cash disbursed and marked SENT.' })
        clearAllCache()
        await loadTransmittals()
      } catch (err) {
        setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Disbursement failed.' })
      } finally {
        setLoadingId(null)
      }
    })
  }

  async function handleVerifySpareChange(trId: number) {
    const spareChange = Number(spareChangeInputs[trId] || 0)
    if (spareChange < 0) {
      setFeedback({ type: 'error', message: 'Spare change cannot be negative.' })
      return
    }

    // 0013 Gate B (client pre-check; the server action and the DB trigger
    // enforce the same rule). The requisition records how much must come back
    // — Accounting may not close the transmittal for less than that.
    const row = transmittals.find(t => t.id === trId)

    // 0014 Gate C (client pre-check; the server action and the DB trigger
    // enforce the same rule). Closing before the requester signs off would
    // skip the step that computes the spare change owed.
    if (row?.mrs && !isDeliveryVerified(row.mrs)) {
      setFeedback({
        type: 'error',
        message:
          `${row.mrs.mrs_number} has not been verified as delivered by the requester. ` +
          `The requesting department must sign off the delivery (Form 14) before this ` +
          `transmittal can be closed — that step records how much spare change is owed.`,
      })
      return
    }

    if (row?.mrs) {
      const required = Number(row.mrs.spare_change_required ?? 0)
      const alreadyReturned = Number(row.mrs.spare_change_returned ?? 0)
      const shortfall = required - (alreadyReturned + spareChange)
      if (shortfall > SPARE_CHANGE_TOLERANCE) {
        setFeedback({
          type: 'error',
          message:
            `Spare change is short by ₱${shortfall.toFixed(2)}. ${row.mrs.mrs_number} requires ` +
            `₱${required.toFixed(2)} to be returned before this transmittal can be closed.`,
        })
        return
      }
    }

    await runLocked('Verifying spare change & closing MRS…', async () => {
    setLoadingId(trId)
    setFeedback(null)
    try {
      const result = await verifyCashAndMarkReceived({
        transmittalId: trId,
        spareChangeReturned: spareChange,
      })

      // The action returns a structured result (never throws) so the real
      // reason is shown instead of an opaque React #441 digest.
      if (!result.success) {
        setFeedback({ type: 'error', message: result.error ?? 'Verification failed.' })
        await loadTransmittals()
        return
      }

      setFeedback({
        type: 'success',
        message: `Verified! Net disbursed: ₱${(result.netDisbursed ?? 0).toFixed(2)}. MRS → CLOSED.`,
      })
      // The close cascades into the MRS ledger and delivery queues.
      clearAllCache()
      await loadTransmittals()
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Verification failed.' })
    } finally {
      setLoadingId(null)
    }
    })
  }

  const filtered = transmittals.filter(t => {
    if (filter === 'ALL') return true
    return t.sender_status === filter || t.receiver_status === filter
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Banknote className="w-5 h-5 text-white" />
          </div>
          Accounting — Transmittals
        </h1>
        <p className="text-sm text-slate-400 mt-1">Form 11 — Disburse Cash, Verify Spare Change & Close MRS</p>
      </div>

      {migrationPending && (
        <div className="px-4 py-3 rounded-xl flex items-start gap-3 text-sm bg-amber-900/40 border border-amber-700/50 text-amber-200">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Spare-change reconciliation is not active yet.</p>
            <p className="text-xs mt-0.5 text-amber-300/90">
              Migration <span className="font-mono">0013_availability_and_spare_change_gates.sql</span> has
              not been applied to this Supabase project, so the required spare-change amount cannot be
              shown or enforced. Run it in the SQL Editor to enable the gate.
            </p>
          </div>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div className={`px-4 py-3 rounded-xl flex items-center gap-3 text-sm ${
          feedback.type === 'success'
            ? 'bg-emerald-900/40 border border-emerald-700/50 text-emerald-300'
            : 'bg-red-900/40 border border-red-700/50 text-red-300'
        }`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 flex-shrink-0" />}
          {feedback.message}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        {(['ALL', 'PENDING', 'SENT', 'RECEIVED'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === f
                ? 'bg-violet-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            {f}
          </button>
        ))}
        <span className="text-xs text-slate-500 ml-2">{filtered.length} transmittal(s)</span>
      </div>

      {/* Transmittal Cards */}
      <div className="space-y-4">
        {filtered.length === 0 && (
          <div className="text-center py-16 text-slate-500 text-sm">No transmittals found.</div>
        )}

        {filtered.map(tr => (
          <div
            key={tr.id}
            className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4 hover:border-slate-700 transition-colors"
          >
            {/* Top row */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Link href={`/audit-logs/transmittal_form/${tr.id}`} className="text-sm font-bold text-white font-mono hover:text-cyan-300" title="View audit history">{tr.transmittal_number}</Link>
                  {tr.batch_code && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/50">
                      {tr.batch_code}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {tr.transmittal_type.replace(/_/g, ' ')} •{' '}
                  {tr.created_at ? new Date(tr.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </div>
              </div>

              <div className="text-right">
                <span className="text-lg font-bold text-emerald-400">
                  ₱{Number(tr.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
                <div className="flex items-center gap-2 mt-1 justify-end">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${STATUS_STYLES[tr.sender_status] || ''}`}>
                    Sender: {tr.sender_status}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${STATUS_STYLES[tr.receiver_status] || ''}`}>
                    Receiver: {tr.receiver_status}
                  </span>
                </div>
              </div>
            </div>

            {/* Details row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-slate-500">From:</span>
                <span className="ml-1 text-slate-300">{tr.sender?.full_name || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500">To:</span>
                <span className="ml-1 text-slate-300">{tr.receiver?.full_name || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500">MRS:</span>
                <span className="ml-1 text-slate-300 font-mono">{tr.mrs?.mrs_number || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500">MRS Status:</span>
                <span className="ml-1 text-slate-300">{tr.mrs?.overall_status?.replace(/_/g, ' ') || '—'}</span>
                {tr.mrs && outstandingSpareChange(tr.mrs) > 0 && (
                  <span className="ml-1 text-rose-400 font-mono font-bold">
                    · ₱{outstandingSpareChange(tr.mrs).toFixed(2)} due
                  </span>
                )}
              </div>
            </div>

            {tr.notes && (
              <p className="text-xs text-slate-400 bg-slate-800/40 rounded-lg px-3 py-2">{tr.notes}</p>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-1">
              {/* Disburse: enabled when sender_status = PENDING */}
              {tr.sender_status === 'PENDING' && (
                <button
                  onClick={() => handleDisburse(tr.id)}
                  disabled={loadingId === tr.id || isLocked}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold flex items-center gap-2 hover:bg-blue-500 disabled:opacity-50 transition-all"
                >
                  {loadingId === tr.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  Disburse Cash & Mark Sent
                </button>
              )}

              {/* Verify spare change: enabled when sender_status = SENT.
                  0013 Gate B — the amount entered must cover the spare change
                  recorded on the requisition at delivery sign-off (Form 14). */}
              {tr.sender_status === 'SENT' && tr.receiver_status !== 'RECEIVED' && (() => {
                const required = Number(tr.mrs?.spare_change_required ?? 0)
                const alreadyReturned = Number(tr.mrs?.spare_change_returned ?? 0)
                const entered = Number(spareChangeInputs[tr.id] || 0)
                const shortfall = required - (alreadyReturned + entered)
                const isShort = required > 0 && shortfall > SPARE_CHANGE_TOLERANCE
                // 0014 Gate C — gate on the requester's sign-off, NOT on
                // FULFILLED: the purchaser's "save actuals" step sets FULFILLED
                // before the requester confirms receipt, so FULFILLED alone
                // would let Accounting close before the spare change is known.
                const notDelivered = Boolean(tr.mrs) && !isDeliveryVerified(tr.mrs!)

                return (
                  <div className="flex flex-col gap-2 flex-1">
                    {required > 0 && (
                      <div className="text-[11px] font-semibold flex flex-wrap items-center gap-2">
                        <span className="text-slate-400">Spare change required:</span>
                        <span className="font-mono text-amber-300">₱{required.toFixed(2)}</span>
                        {alreadyReturned > 0 && (
                          <span className="text-slate-500 font-mono">
                            (₱{alreadyReturned.toFixed(2)} already returned)
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <div className="relative w-36">
                        <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={spareChangeInputs[tr.id] || ''}
                          onChange={e =>
                            setSpareChangeInputs(prev => ({ ...prev, [tr.id]: e.target.value }))
                          }
                          className={`w-full bg-slate-800 border rounded-lg pl-7 pr-3 py-2 text-xs text-slate-200 outline-none focus:ring-2 ${
                            isShort
                              ? 'border-rose-700 focus:ring-rose-500'
                              : 'border-slate-700 focus:ring-emerald-500'
                          }`}
                          placeholder={required > 0 ? required.toFixed(2) : 'Spare change'}
                        />
                      </div>
                      <button
                        onClick={() => handleVerifySpareChange(tr.id)}
                        disabled={loadingId === tr.id || isShort || notDelivered || isLocked}
                        title={
                          notDelivered
                            ? 'Delivery must be signed off by the requesting department first (Form 14)'
                            : isShort
                              ? `Short by ₱${shortfall.toFixed(2)} — the full spare change must be received`
                              : undefined
                        }
                        className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold flex items-center gap-2 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        {loadingId === tr.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ArrowDownCircle className="w-3.5 h-3.5" />
                        )}
                        Verify & Close MRS
                      </button>
                    </div>

                    {notDelivered && (
                      <span className="text-[11px] text-amber-400 flex items-center gap-1.5">
                        <Clock className="w-3 h-3 shrink-0" />
                        Awaiting delivery sign-off by the requesting department (Form 14)
                      </span>
                    )}
                    {isShort && !notDelivered && (
                      <span className="text-[11px] text-rose-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        Short by ₱{shortfall.toFixed(2)} — this transmittal cannot be closed until the full
                        spare change is received.
                      </span>
                    )}
                  </div>
                )
              })()}

              {/* Already completed */}
              {tr.receiver_status === 'RECEIVED' && (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  Completed
                  {tr.received_at && (
                    <span className="text-slate-500 ml-1">
                      {new Date(tr.received_at).toLocaleDateString('en-PH')}
                    </span>
                  )}
                </div>
              )}

              {tr.sender_status === 'SENT' && tr.receiver_status === 'PENDING' && (
                <div className="flex items-center gap-1.5 text-xs text-amber-400 ml-auto">
                  <Clock className="w-3.5 h-3.5" />
                  Awaiting spare change verification
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
