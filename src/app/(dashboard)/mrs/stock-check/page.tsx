'use client'

import React, { useState, useEffect } from 'react'
import {
  PackageCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Boxes,
  Warehouse,
  Send,
  Building,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useActionLock } from '@/components/ui/ActionLock'
import { issueStockFormSK } from '@/lib/actions/mrs-actions'

interface LineItem {
  id: number
  item_description: string
  qty_requested: number
  unit: string
  qty_issued_from_stock: number
}

interface MRSQueueItem {
  id: number
  mrs_number: string
  purpose: string
  created_at: string
  total_estimated_cost: number
  jo_id: number | null
  department: { department_name: string } | null
  requester: { full_name: string } | null
  job_order: { jo_number: string; title: string } | null
  mrs_line_items: LineItem[]
}

export default function StockCheckPage() {
  const { runLocked } = useActionLock()
  const [queue, setQueue] = useState<MRSQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMRS, setSelectedMRS] = useState<MRSQueueItem | null>(null)
  const [issuedQuantities, setIssuedQuantities] = useState<Record<number, number>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const supabase = createClient()

  const fetchQueue = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: qErr } = await supabase
        .from('material_requisitions')
        .select(`
          id, mrs_number, purpose, created_at, total_estimated_cost, jo_id,
          department:departments(department_name),
          requester:users!material_requisitions_requester_id_fkey(full_name),
          job_order:job_orders!material_requisitions_jo_id_fkey(jo_number, title),
          mrs_line_items(id, item_description, qty_requested, unit, qty_issued_from_stock)
        `)
        .eq('overall_status', 'PENDING_MANAGER')
        .eq('is_emergency_fast_track', false)
        .order('created_at', { ascending: true })

      if (qErr) throw qErr
      setQueue((data as MRSQueueItem[]) || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load stock-check queue.')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchQueue()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [fetchQueue])

  const handleOpenModal = (mrs: MRSQueueItem) => {
    setSelectedMRS(mrs)
    const initialQuantities: Record<number, number> = {}
    mrs.mrs_line_items.forEach(item => {
      // Default to 0 or previous
      initialQuantities[item.id] = item.qty_issued_from_stock || 0
    })
    setIssuedQuantities(initialQuantities)
  }

  const handleQtyChange = (itemId: number, max: number, value: string) => {
    const num = Math.max(0, Math.min(max, Number(value) || 0))
    setIssuedQuantities(prev => ({ ...prev, [itemId]: num }))
  }

  const handleIssueAll = (mrs: MRSQueueItem) => {
    const allFull: Record<number, number> = {}
    mrs.mrs_line_items.forEach(item => {
      allFull[item.id] = item.qty_requested
    })
    setIssuedQuantities(allFull)
  }

  const handleSubmitStockCheck = async () => {

    await runLocked('Issuing stock…', async () => {
      if (!selectedMRS) return
      setSubmitting(true)
      setError(null)
      setActionSuccess(null)

      try {
        const allocations = selectedMRS.mrs_line_items.map(item => ({
          lineItemId: item.id,
          qtyIssuedFromStock: issuedQuantities[item.id] || 0,
        }))

        const res = await issueStockFormSK({
          mrsId: selectedMRS.id,
          allocations,
        })

        if (res.success) {
          setActionSuccess(
            res.fullyIssued
              ? `Requisition ${selectedMRS.mrs_number} fully issued from stock! Linked JO updated to MATERIALS_RECEIVED.`
              : `Stock deducted. Unfulfilled balance forwarded to Manager for approval.`
          )
          setSelectedMRS(null)
          fetchQueue()
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to process stock check.')
      } finally {
        setSubmitting(false)
      }

    })

  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Warehouse className="w-6 h-6 text-amber-400" />
            <h1 className="text-xl font-black text-white tracking-tight">
              Storekeeper Stock Check Gate
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Form 6 — Check warehouse on-hand stock before procurement canvassing starts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-amber-950/60 border border-amber-800/80 rounded-lg text-xs font-bold text-amber-300">
            {queue.length} Awaiting Warehouse Verification
          </span>
        </div>
      </div>

      {actionSuccess && (
        <div className="p-3.5 bg-emerald-950/40 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-950/40 border border-red-800 rounded-xl text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Queue List */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500 mr-3" />
          <span>Scanning inventory queue...</span>
        </div>
      ) : queue.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-500 mx-auto">
            <PackageCheck className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-white">Stock-Check Queue Clear</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            No material requisitions are currently waiting for warehouse stock verification.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {queue.map(mrs => (
            <div
              key={mrs.id}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 hover:border-slate-700 transition-colors flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-sm font-black text-amber-400">
                      {mrs.mrs_number}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                      <Building className="w-3.5 h-3.5" />
                      <span>{mrs.department?.department_name ?? 'General'}</span>
                      <span>•</span>
                      <span>{mrs.requester?.full_name ?? 'Requester'}</span>
                    </div>
                  </div>
                  <span className="font-mono text-xs font-bold text-slate-300">
                    Est. ₱{Number(mrs.total_estimated_cost).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {mrs.job_order && (
                  <div className="p-2 bg-slate-950 border border-slate-800 rounded-lg text-[11px] text-slate-300">
                    <span className="text-slate-500">Linked JO: </span>
                    <span className="font-mono font-semibold text-blue-400">{mrs.job_order.jo_number}</span>
                    <span className="text-slate-400 ml-1 truncate">({mrs.job_order.title})</span>
                  </div>
                )}

                <p className="text-xs text-slate-300 line-clamp-2">{mrs.purpose}</p>

                {/* Items preview list */}
                <div className="space-y-1 pt-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                    Requested Items ({mrs.mrs_line_items.length}):
                  </span>
                  <div className="space-y-1">
                    {mrs.mrs_line_items.slice(0, 3).map(item => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-950/70 border border-slate-800/60"
                      >
                        <span className="truncate text-slate-200">{item.item_description}</span>
                        <span className="font-mono font-bold text-slate-400 shrink-0 ml-2">
                          {item.qty_requested} {item.unit}
                        </span>
                      </div>
                    ))}
                    {mrs.mrs_line_items.length > 3 && (
                      <span className="text-[10px] text-slate-500 block text-right">
                        +{mrs.mrs_line_items.length - 3} more items
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => handleOpenModal(mrs)}
                  className="w-full py-2 px-3 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Boxes className="w-4 h-4" />
                  <span>Verify Warehouse Stock</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stock Check Modal */}
      {selectedMRS && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-white">Issue Stock from Warehouse</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Requisition <span className="font-mono text-amber-400">{selectedMRS.mrs_number}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMRS(null)}
                className="text-slate-400 hover:text-white text-xs font-bold px-2 py-1 bg-slate-800 rounded"
              >
                Close
              </button>
            </div>

            <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-xs text-slate-300">Quick action: Have everything on hand?</span>
              <button
                type="button"
                onClick={() => handleIssueAll(selectedMRS)}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors"
              >
                Issue 100% In Stock
              </button>
            </div>

            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-300 block uppercase tracking-wider">
                Line Items Stock Allocation:
              </span>

              {selectedMRS.mrs_line_items.map(item => {
                const currentIssued = issuedQuantities[item.id] || 0
                const remainingToProcure = Math.max(0, item.qty_requested - currentIssued)
                return (
                  <div
                    key={item.id}
                    className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{item.item_description}</span>
                      <span className="text-xs text-slate-400">
                        Requested: <strong className="text-slate-200">{item.qty_requested} {item.unit}</strong>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center pt-2 border-t border-slate-800/80">
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-slate-400">
                          Qty Issued from Stock ({item.unit})
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={item.qty_requested}
                          value={currentIssued}
                          onChange={e => handleQtyChange(item.id, item.qty_requested, e.target.value)}
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-bold"
                        />
                      </div>

                      <div className="text-xs sm:text-right pt-2 sm:pt-0">
                        <span className="text-[10px] text-slate-400 block">Remaining for Canvassing:</span>
                        <span className={`font-mono font-bold ${
                          remainingToProcure === 0 ? 'text-emerald-400' : 'text-amber-400'
                        }`}>
                          {remainingToProcure === 0
                            ? 'Covered 100% by warehouse'
                            : `${remainingToProcure} ${item.unit} needed from vendors`}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setSelectedMRS(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmitStockCheck}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg shadow-amber-500/20 flex items-center gap-1.5 transition-colors"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>Confirm Stock Deduction & Forward</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
