'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  createTransmittal,
  createBatchTransmittal,
  type CreateTransmittalInput,
  type BatchTransmittalItem,
} from '@/lib/actions/transmittal-actions'
import { createClient } from '@/lib/supabase/client'
import {
  Send,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Layers,
  DollarSign,
} from 'lucide-react'
import type { TransmittalType } from '@/types/index'

const TRANSMITTAL_TYPES: { value: TransmittalType; label: string }[] = [
  { value: 'INITIAL_DISBURSEMENT', label: 'Initial Cash Disbursement' },
  { value: 'SUPPLEMENTAL_DISBURSEMENT', label: 'Supplemental Disbursement' },
  { value: 'EMERGENCY_REIMBURSEMENT', label: 'Emergency Reimbursement' },
  { value: 'DIRECT_ONLINE_DISBURSEMENT', label: 'Direct Online Disbursement' },
  { value: 'SPARE_CHANGE_RETURN', label: 'Spare Change Return' },
  { value: 'FD_REVOLVING_DISBURSEMENT', label: 'FD Revolving Disbursement' },
  { value: 'FD_REVOLVING_REPLENISHMENT', label: 'FD Revolving Replenishment' },
  { value: 'BATCH_DISBURSEMENT', label: 'Batch Disbursement' },
]

interface ApprovedMRS {
  id: number
  mrs_number: string
  purpose: string
  allocated_budget: number
  total_estimated_cost: number
}

interface Receiver {
  id: string
  full_name: string
  role: string
}

export default function CreateTransmittalPage() {
  const router = useRouter()
  const supabase = createClient()

  // Single mode state
  const [transmittalType, setTransmittalType] = useState<TransmittalType>('INITIAL_DISBURSEMENT')
  const [selectedMrsId, setSelectedMrsId] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [receiverUserId, setReceiverUserId] = useState('')
  const [notes, setNotes] = useState('')

  // Batch mode state
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [batchItems, setBatchItems] = useState<(BatchTransmittalItem & { mrs_number?: string })[]>([])

  // Data
  const [approvedMRS, setApprovedMRS] = useState<ApprovedMRS[]>([])
  const [receivers, setReceivers] = useState<Receiver[]>([])
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadApprovedMRS = useCallback(async () => {
    const { data } = await supabase
      .from('material_requisitions')
      .select('id, mrs_number, purpose, allocated_budget, total_estimated_cost')
      .in('overall_status', ['APPROVED_READY_TO_ORDER', 'TRANSMITTAL_IN_PROGRESS', 'FULFILLED'])
      .order('created_at', { ascending: false })

    setApprovedMRS(data || [])
  }, [supabase])

  const loadReceivers = useCallback(async () => {
    const { data } = await supabase
      .from('users')
      .select('id, full_name, role')
      .eq('account_status', 'ACTIVE')
      .order('full_name')

    setReceivers(data || [])
  }, [supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadApprovedMRS()
      void loadReceivers()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadApprovedMRS, loadReceivers])

  function addBatchItem() {
    if (batchItems.length >= 50) return
    setBatchItems([...batchItems, { mrsId: 0, amount: 0 }])
  }

  function removeBatchItem(index: number) {
    setBatchItems(batchItems.filter((_, i) => i !== index))
  }

  function updateBatchItem(index: number, field: keyof BatchTransmittalItem, value: number) {
    const updated = [...batchItems]
    updated[index] = { ...updated[index], [field]: value }

    // Auto-fill amount from MRS allocated budget
    if (field === 'mrsId') {
      const mrs = approvedMRS.find(m => m.id === value)
      if (mrs) {
        updated[index].amount = Number(mrs.allocated_budget) || 0
        updated[index].mrs_number = mrs.mrs_number
      }
    }

    setBatchItems(updated)
  }

  const batchTotal = batchItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)

  async function handleSubmitSingle(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const input: CreateTransmittalInput = {
        mrsId: selectedMrsId,
        transmittalType,
        amount: Number(amount),
        receiverUserId,
        notes: notes.trim() || undefined,
      }

      const result = await createTransmittal(input)
      if (result.success) {
        setSuccess(`Transmittal ${result.transmittal.transmittal_number} created successfully!`)
        setTimeout(() => router.push('/mrs'), 2000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create transmittal.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitBatch(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const validItems = batchItems.filter(i => i.mrsId > 0 && i.amount > 0)
      if (!validItems.length) {
        throw new Error('Add at least one valid MRS with an amount to the batch.')
      }

      const result = await createBatchTransmittal({
        items: validItems,
        receiverUserId,
        transmittalType,
        notes: notes.trim() || undefined,
      })

      if (result.success) {
        setSuccess(`Batch ${result.batchCode} created! ${result.transmittals.length} transmittals, total ₱${result.totalAmount.toFixed(2)}.`)
        setTimeout(() => router.push('/mrs'), 2000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch creation failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Send className="w-5 h-5 text-white" />
            </div>
            Create Transmittal
          </h1>
          <p className="text-sm text-slate-400 mt-1">Form 10 — Cash Disbursement & Batch Handoff</p>
        </div>

        {/* Batch Toggle */}
        <button
          type="button"
          onClick={() => setIsBatchMode(!isBatchMode)}
          className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all ${
            isBatchMode
              ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/20'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          <Layers className="w-4 h-4" />
          {isBatchMode ? 'Batch Mode ON' : 'Batch Mode'}
        </button>
      </div>

      {/* Success / Error Alerts */}
      {success && (
        <div className="bg-emerald-900/40 border border-emerald-700/50 text-emerald-300 px-4 py-3 rounded-xl flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{success}</span>
        </div>
      )}

      {error && (
        <div className="bg-red-900/40 border border-red-700/50 text-red-300 px-4 py-3 rounded-xl flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      <form onSubmit={isBatchMode ? handleSubmitBatch : handleSubmitSingle} className="space-y-6">
        {/* Common Fields */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-5">
          <h2 className="text-base font-semibold text-white">Transmittal Details</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Transmittal Type */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Transmittal Type</label>
              <select
                value={transmittalType}
                onChange={e => setTransmittalType(e.target.value as TransmittalType)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
              >
                {TRANSMITTAL_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Receiver */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Receiver</label>
              <select
                value={receiverUserId}
                onChange={e => setReceiverUserId(e.target.value)}
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
              >
                <option value="">Select receiver…</option>
                {receivers.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.full_name} ({r.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-none"
              placeholder="Any additional remarks…"
            />
          </div>
        </div>

        {/* Single Mode: MRS + Amount */}
        {!isBatchMode && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-5">
            <h2 className="text-base font-semibold text-white">Linked MRS & Amount</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Material Requisition</label>
                <select
                  value={selectedMrsId ?? ''}
                  onChange={e => {
                    const id = Number(e.target.value)
                    setSelectedMrsId(id || null)
                    const mrs = approvedMRS.find(m => m.id === id)
                    if (mrs) setAmount(String(mrs.allocated_budget || mrs.total_estimated_cost || ''))
                  }}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                >
                  <option value="">No linked MRS (standalone)</option>
                  {approvedMRS.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.mrs_number} — {m.purpose.substring(0, 40)}… (₱{Number(m.allocated_budget).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Amount (₱)</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Batch Mode: MRS Items Table */}
        {isBatchMode && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-400" />
                Batch Items ({batchItems.length}/50)
              </h2>
              <button
                type="button"
                onClick={addBatchItem}
                disabled={batchItems.length >= 50}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add MRS
              </button>
            </div>

            {batchItems.length === 0 && (
              <div className="text-center py-8 text-slate-500 text-sm">
                Click &quot;Add MRS&quot; to begin building the batch.
              </div>
            )}

            <div className="space-y-3">
              {batchItems.map((item, index) => (
                <div key={index} className="flex items-center gap-3 bg-slate-800/50 rounded-lg p-3">
                  <span className="text-xs font-mono text-slate-500 w-6">{index + 1}.</span>
                  <select
                    value={item.mrsId || ''}
                    onChange={e => updateBatchItem(index, 'mrsId', Number(e.target.value))}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Select MRS…</option>
                    {approvedMRS.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.mrs_number} — ₱{Number(m.allocated_budget).toLocaleString()}
                      </option>
                    ))}
                  </select>
                  <div className="relative w-40">
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={item.amount || ''}
                      onChange={e => updateBatchItem(index, 'amount', Number(e.target.value))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-7 pr-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="0.00"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeBatchItem(index)}
                    className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {batchItems.length > 0 && (
              <div className="flex justify-end">
                <div className="bg-emerald-900/30 border border-emerald-800/50 rounded-lg px-4 py-2 text-sm">
                  <span className="text-slate-400">Total: </span>
                  <span className="font-bold text-emerald-400">₱{batchTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Submit */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 rounded-xl bg-emerald-600 text-white font-semibold text-sm flex items-center gap-2 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-500/20"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing…
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                {isBatchMode ? `Submit Batch (${batchItems.length} items)` : 'Create Transmittal'}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
