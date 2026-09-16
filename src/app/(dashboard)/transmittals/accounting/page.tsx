'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  disburseCashAndMarkSent,
  verifyCashAndMarkReceived,
} from '@/lib/actions/transmittal-actions'
import { createBrowserClient } from '@/lib/supabase/client'
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
  mrs: { mrs_number: string; overall_status: string } | null
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-900/30 text-amber-400 border-amber-800/50',
  SENT: 'bg-blue-900/30 text-blue-400 border-blue-800/50',
  RECEIVED: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/50',
  CANCELLED: 'bg-red-900/30 text-red-400 border-red-800/50',
}

export default function AccountingTransmittalPage() {
  const supabase = createBrowserClient()

  const [transmittals, setTransmittals] = useState<TransmittalRow[]>([])
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [spareChangeInputs, setSpareChangeInputs] = useState<Record<number, string>>({})
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'SENT' | 'RECEIVED'>('ALL')

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

    // Fetch MRS
    const { data: mrsList } = mrsIds.size > 0
      ? await supabase.from('material_requisitions').select('id, mrs_number, overall_status').in('id', Array.from(mrsIds))
      : { data: [] }

    const mrsMap = new Map((mrsList || []).map(m => [m.id, m]))

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
      mrs: row.mrs_id && mrsMap.get(row.mrs_id) ? { mrs_number: mrsMap.get(row.mrs_id)!.mrs_number, overall_status: mrsMap.get(row.mrs_id)!.overall_status } : null,
    }))

    setTransmittals(enriched)
  }, [supabase])

  useEffect(() => {
    loadTransmittals()
  }, [loadTransmittals])

  async function handleDisburse(trId: number) {
    setLoadingId(trId)
    setFeedback(null)
    try {
      await disburseCashAndMarkSent(trId)
      setFeedback({ type: 'success', message: 'Cash disbursed and marked SENT.' })
      loadTransmittals()
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Disbursement failed.' })
    } finally {
      setLoadingId(null)
    }
  }

  async function handleVerifySpareChange(trId: number) {
    const spareChange = Number(spareChangeInputs[trId] || 0)
    if (spareChange < 0) {
      setFeedback({ type: 'error', message: 'Spare change cannot be negative.' })
      return
    }

    setLoadingId(trId)
    setFeedback(null)
    try {
      const result = await verifyCashAndMarkReceived({
        transmittalId: trId,
        spareChangeReturned: spareChange,
      })
      setFeedback({
        type: 'success',
        message: `Verified! Net disbursed: ₱${result.netDisbursed.toFixed(2)}. MRS → CLOSED.`,
      })
      loadTransmittals()
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Verification failed.' })
    } finally {
      setLoadingId(null)
    }
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
                  <span className="text-sm font-bold text-white font-mono">{tr.transmittal_number}</span>
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
                  disabled={loadingId === tr.id}
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

              {/* Verify spare change: enabled when sender_status = SENT */}
              {tr.sender_status === 'SENT' && tr.receiver_status !== 'RECEIVED' && (
                <div className="flex items-center gap-2 flex-1">
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
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-7 pr-3 py-2 text-xs text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="Spare change"
                    />
                  </div>
                  <button
                    onClick={() => handleVerifySpareChange(tr.id)}
                    disabled={loadingId === tr.id}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold flex items-center gap-2 hover:bg-emerald-500 disabled:opacity-50 transition-all"
                  >
                    {loadingId === tr.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowDownCircle className="w-3.5 h-3.5" />
                    )}
                    Verify & Close MRS
                  </button>
                </div>
              )}

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
