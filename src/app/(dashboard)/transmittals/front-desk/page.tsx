'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  fdCodDisbursement,
  fdReplenishFloat,
} from '@/lib/actions/transmittal-actions'
import { FD_COD_MRS_STATUSES } from '@/lib/status-machines'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  QrCode,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Banknote,
  RefreshCw,
  Truck,
  DollarSign,
} from 'lucide-react'

interface PendingDeliveryMRS {
  id: number
  mrs_number: string
  purpose: string
  total_estimated_cost: number
  requester: { full_name: string } | null
}

interface FDUser {
  id: string
  full_name: string
}

export default function FrontDeskTransmittalPage() {
  const supabase = createBrowserClient()

  const [mode, setMode] = useState<'cod' | 'replenish'>('cod')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // COD mode state
  const [pendingMRS, setPendingMRS] = useState<PendingDeliveryMRS[]>([])
  const [selectedMrsId, setSelectedMrsId] = useState<number | null>(null)
  const [codAmount, setCodAmount] = useState('')
  const [barcodeValue, setBarcodeValue] = useState('')
  const [codNotes, setCodNotes] = useState('')

  // Replenish mode state
  const [replenishAmount, setReplenishAmount] = useState('')
  const [fdUsers, setFdUsers] = useState<FDUser[]>([])
  const [selectedFdUser, setSelectedFdUser] = useState('')
  const [replenishNotes, setReplenishNotes] = useState('')

  const loadPendingDeliveries = useCallback(async () => {
    // CASH CHAIN: only online/COD orders whose purchase is in flight may
    // receive a float advance — same window the server action and the DB gate
    // enforce.
    const { data } = await supabase
      .from('material_requisitions')
      .select('id, mrs_number, purpose, total_estimated_cost, requester_id')
      .eq('is_online_purchase', true)
      .in('overall_status', [...FD_COD_MRS_STATUSES])
      .order('created_at', { ascending: false })

    if (data && data.length > 0) {
      // Batch fetch requester names
      const requesterIds = [...new Set(data.map(d => d.requester_id))]
      const { data: users } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', requesterIds)

      const userMap = new Map((users || []).map(u => [u.id, u]))

      const enriched: PendingDeliveryMRS[] = data.map(row => ({
        id: row.id,
        mrs_number: row.mrs_number,
        purpose: row.purpose,
        total_estimated_cost: row.total_estimated_cost,
        requester: userMap.get(row.requester_id) ? { full_name: userMap.get(row.requester_id)!.full_name } : null,
      }))

      setPendingMRS(enriched)
    } else {
      setPendingMRS([])
    }
  }, [supabase])

  const loadFDUsers = useCallback(async () => {
    const { data } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('role', 'FRONT_DESK')
      .eq('account_status', 'ACTIVE')
      .order('full_name')

    setFdUsers(data || [])
  }, [supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPendingDeliveries()
      void loadFDUsers()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadPendingDeliveries, loadFDUsers])

  async function handleCodSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedMrsId || !barcodeValue.trim()) {
      setFeedback({ type: 'error', message: 'Select an MRS and scan/enter the courier barcode.' })
      return
    }

    setLoading(true)
    setFeedback(null)
    try {
      const result = await fdCodDisbursement({
        mrsId: selectedMrsId,
        amount: Number(codAmount),
        courierTrackingBarcode: barcodeValue.trim(),
        notes: codNotes.trim() || undefined,
      })

      if (result.success) {
        setFeedback({
          type: 'success',
          message: `COD disbursement ${result.transmittal.transmittal_number} created! ₱${Number(codAmount).toFixed(2)} disbursed from FD float.`,
        })
        setSelectedMrsId(null)
        setCodAmount('')
        setBarcodeValue('')
        setCodNotes('')
        loadPendingDeliveries()
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'COD disbursement failed.' })
    } finally {
      setLoading(false)
    }
  }

  async function handleReplenish(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFdUser || !replenishAmount) {
      setFeedback({ type: 'error', message: 'Select a Front Desk user and enter the replenishment amount.' })
      return
    }

    setLoading(true)
    setFeedback(null)
    try {
      const result = await fdReplenishFloat({
        amount: Number(replenishAmount),
        receiverUserId: selectedFdUser,
        notes: replenishNotes.trim() || undefined,
      })

      if (result.success) {
        setFeedback({
          type: 'success',
          message: `Float replenished! ${result.transmittal.transmittal_number} — ₱${Number(replenishAmount).toFixed(2)}.`,
        })
        setReplenishAmount('')
        setReplenishNotes('')
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Replenishment failed.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Truck className="w-5 h-5 text-white" />
          </div>
          Front Desk — COD & Float
        </h1>
        <p className="text-sm text-slate-400 mt-1">Form 12 — Off-Hours COD Intake & Next-Day Float Replenishment</p>
      </div>

      {/* Mode Toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMode('cod')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all ${
            mode === 'cod'
              ? 'bg-orange-600 text-white shadow-lg shadow-orange-500/20'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
          }`}
        >
          <QrCode className="w-4 h-4" />
          Mode 1 — COD Intake
        </button>
        <button
          onClick={() => setMode('replenish')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all ${
            mode === 'replenish'
              ? 'bg-teal-600 text-white shadow-lg shadow-teal-500/20'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
          }`}
        >
          <RefreshCw className="w-4 h-4" />
          Mode 2 — Replenish Float
        </button>
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

      {/* Mode 1: COD Barcode Intake */}
      {mode === 'cod' && (
        <form onSubmit={handleCodSubmit} className="space-y-6">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-5">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <QrCode className="w-4 h-4 text-orange-400" />
              COD Delivery — Scan & Disburse
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Select MRS */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Online Purchase MRS</label>
                <select
                  value={selectedMrsId ?? ''}
                  onChange={e => {
                    const id = Number(e.target.value)
                    setSelectedMrsId(id || null)
                    const mrs = pendingMRS.find(m => m.id === id)
                    if (mrs) setCodAmount(String(mrs.total_estimated_cost || ''))
                  }}
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
                >
                  <option value="">Select MRS…</option>
                  {pendingMRS.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.mrs_number} — {m.requester?.full_name || 'Unknown'} (₱{Number(m.total_estimated_cost).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">COD Amount (₱)</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={codAmount}
                    onChange={e => setCodAmount(e.target.value)}
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            {/* Barcode Scanner */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Courier Tracking Barcode
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={barcodeValue}
                  onChange={e => setBarcodeValue(e.target.value)}
                  required
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 font-mono focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
                  placeholder="Scan or type barcode…"
                />
                <div className="p-2.5 rounded-lg bg-orange-900/30 border border-orange-800/50 text-orange-400">
                  <QrCode className="w-5 h-5" />
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Use a barcode scanner or manually enter the courier tracking number.
              </p>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Notes (optional)</label>
              <textarea
                value={codNotes}
                onChange={e => setCodNotes(e.target.value)}
                rows={2}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none resize-none"
                placeholder="Delivery details…"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 rounded-xl bg-orange-600 text-white font-semibold text-sm flex items-center gap-2 hover:bg-orange-500 disabled:opacity-50 transition-all shadow-lg shadow-orange-500/20"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Banknote className="w-4 h-4" />
              )}
              Disburse from FD Float
            </button>
          </div>
        </form>
      )}

      {/* Mode 2: Next-Day Float Replenishment */}
      {mode === 'replenish' && (
        <form onSubmit={handleReplenish} className="space-y-6">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-5">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-teal-400" />
              Next-Day Float Replenishment (BO → Front Desk)
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Front Desk Receiver */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Front Desk Recipient</label>
                <select
                  value={selectedFdUser}
                  onChange={e => setSelectedFdUser(e.target.value)}
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                >
                  <option value="">Select Front Desk user…</option>
                  {fdUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.full_name}</option>
                  ))}
                </select>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Replenishment Amount (₱)</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={replenishAmount}
                    onChange={e => setReplenishAmount(e.target.value)}
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Notes (optional)</label>
              <textarea
                value={replenishNotes}
                onChange={e => setReplenishNotes(e.target.value)}
                rows={2}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none resize-none"
                placeholder="Replenishment notes…"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 rounded-xl bg-teal-600 text-white font-semibold text-sm flex items-center gap-2 hover:bg-teal-500 disabled:opacity-50 transition-all shadow-lg shadow-teal-500/20"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Replenish FD Float
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
