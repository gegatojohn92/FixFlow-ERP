'use client'

import React, { useState, useEffect } from 'react'
import {
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
  Loader2,
  DollarSign,
  Star,
  AlertTriangle,
  Receipt,
  Truck,
  Building,
  Send,
  Eye,
  ImageIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { purchaserConfirmCash, purchaserCompleteTrip, type PurchaseItemResult } from '@/lib/actions/purchaser-actions'
import CameraCapture from '@/components/shared/CameraCapture'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'
import type { ItemDeliveryStatus } from '@/types/index'

const DELIVERY_STATUSES: Array<{ value: ItemDeliveryStatus; label: string }> = [
  { value: 'DELIVERED', label: 'Delivered (On-Site)' },
  { value: 'IN_TRANSIT', label: 'In Transit / Shipped' },
  { value: 'BACKORDERED', label: 'Backordered by Supplier' },
  { value: 'BUDGET_EXHAUSTED', label: 'Budget Exhausted' },
  { value: 'UNAVAILABLE', label: 'Unavailable / Out of Stock' },
]

interface LineItem {
  id: number
  item_description: string
  qty_requested: number
  qty_issued_from_stock: number
  qty_fulfilled: number
  unit: string
  est_unit_price: number
  actual_unit_price: number
  store_name: string | null
  item_delivery_status: ItemDeliveryStatus
  vendor_rating: number
  is_overpriced: boolean
  reference_photo_url: string | null
}

interface MRSPurchaseItem {
  id: number
  mrs_number: string
  purpose: string
  overall_status: string
  allocated_budget: number | null
  est_shipping_fee: number
  actual_shipping_fee: number | null
  department: { department_name: string } | null
  requester: { full_name: string } | null
  job_order: { jo_number: string; title: string } | null
  mrs_line_items: LineItem[]
}

export default function PurchaserQueuePage() {
  const [queue, setQueue] = useState<MRSPurchaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMRS, setSelectedMRS] = useState<MRSPurchaseItem | null>(null)

  // Trip inputs
  const [itemsData, setItemsData] = useState<PurchaseItemResult[]>([])
  const [actualShipping, setActualShipping] = useState<number>(0)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [activePhoto, setActivePhoto] = useState<{ url: string; title: string } | null>(null)

  const supabase = createClient()

  const fetchQueue = async () => {
    setLoading(true)
    setError(null)
    try {
      // Requisitions ready for purchase trip or in progress
      const { data, error: qErr } = await supabase
        .from('material_requisitions')
        .select(`
          id, mrs_number, purpose, overall_status, allocated_budget, est_shipping_fee,
          actual_shipping_fee,
          department:departments(department_name),
          requester:users!material_requisitions_requester_id_fkey(full_name),
          job_order:job_orders!material_requisitions_jo_id_fkey(jo_number, title),
          mrs_line_items(
            id, item_description, qty_requested, qty_issued_from_stock, qty_fulfilled,
            unit, est_unit_price, actual_unit_price, store_name, item_delivery_status,
            vendor_rating, is_overpriced, reference_photo_url
          )
        `)
        .in('overall_status', [
          'APPROVED_READY_TO_ORDER',
          'TRANSMITTAL_IN_PROGRESS',
          'READY_FOR_PURCHASE',
          'PURCHASING',
          'EMERGENCY_FAST_TRACK',
        ])
        .order('id', { ascending: true })

      if (qErr) throw qErr
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setQueue((data as any) || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load purchaser queue.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchQueue()
  }, [])

  const handleSelectMRS = (mrs: MRSPurchaseItem) => {
    setSelectedMRS(mrs)
    setActualShipping(Number(mrs.actual_shipping_fee) || Number(mrs.est_shipping_fee) || 0)

    const initial = mrs.mrs_line_items.map(item => {
      const remainingNeeded = Math.max(0, item.qty_requested - item.qty_issued_from_stock)
      return {
        lineItemId: item.id,
        itemDescription: item.item_description,
        storeName: item.store_name || '',
        qtyFulfilled: item.qty_fulfilled > 0 ? item.qty_fulfilled : remainingNeeded,
        actualUnitPrice: item.actual_unit_price > 0 ? item.actual_unit_price : item.est_unit_price,
        itemDeliveryStatus: (item.item_delivery_status === 'PENDING' ? 'DELIVERED' : item.item_delivery_status) as ItemDeliveryStatus,
        vendorRating: item.vendor_rating || 5,
        isOverpriced: item.is_overpriced || false,
      }
    })
    setItemsData(initial)
  }

  const updateItemData = (index: number, field: keyof PurchaseItemResult, value: unknown) => {
    setItemsData(prev => {
      const copy = [...prev]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
  }

  // Confirm cash handoff
  const handleConfirmCash = async () => {
    if (!selectedMRS) return
    setSubmitting(true)
    setError(null)
    try {
      await purchaserConfirmCash(selectedMRS.id)
      setActionSuccess(`Cash receipt confirmed for ${selectedMRS.mrs_number}. Status updated to PURCHASING.`)
      fetchQueue()
      setSelectedMRS(prev => (prev ? { ...prev, overall_status: 'PURCHASING' } : null))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to confirm cash receipt.')
    } finally {
      setSubmitting(false)
    }
  }

  // Complete Trip and Record Actuals
  const handleCompleteTrip = async () => {
    if (!selectedMRS) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await purchaserCompleteTrip({
        mrsId: selectedMRS.id,
        actualShippingFee: actualShipping,
        items: itemsData,
      })

      if (res.success) {
        setActionSuccess(
          `Purchasing trip logged! Total Spent: ₱${res.totalActualSpent.toFixed(2)}. Requisition moved to ${res.nextStatus}.`
        )
        setSelectedMRS(null)
        fetchQueue()
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to complete purchasing record.')
    } finally {
      setSubmitting(false)
    }
  }

  // Calculate live trip total
  const itemsTotal = itemsData.reduce(
    (sum, item) => sum + (Number(item.actualUnitPrice) || 0) * (Number(item.qtyFulfilled) || 0),
    0
  )
  const grandTotal = itemsTotal + (Number(actualShipping) || 0)
  const allocated = Number(selectedMRS?.allocated_budget) || 0
  const variance = allocated - grandTotal
  const isOverBudget = grandTotal > allocated && allocated > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-emerald-400" />
            <h1 className="text-xl font-black text-white tracking-tight">
              Purchaser Procurement Queue
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Form 13 — Confirm disbursed cash, log verified vendor receipts, and record item delivery states.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-emerald-950/60 border border-emerald-800/80 rounded-lg text-xs font-bold text-emerald-300">
            {queue.length} Active in Purchasing
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Requisitions Queue */}
        <div className="lg:col-span-4 space-y-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
            Purchasing Orders
          </span>

          {loading ? (
            <div className="py-12 text-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-500 mx-auto mb-2" />
              <span className="text-xs">Loading queue...</span>
            </div>
          ) : queue.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400">
              No requisitions currently in purchaser queue.
            </div>
          ) : (
            <div className="space-y-2.5">
              {queue.map(mrs => {
                const isSelected = selectedMRS?.id === mrs.id
                return (
                  <button
                    key={mrs.id}
                    type="button"
                    onClick={() => handleSelectMRS(mrs)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-emerald-950/30 border-emerald-600 shadow-lg shadow-emerald-900/20'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-black text-emerald-400">
                        {mrs.mrs_number}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                        {mrs.overall_status}
                      </span>
                    </div>

                    <p className="text-xs text-slate-200 mt-2 line-clamp-1 font-semibold">
                      {mrs.purpose}
                    </p>

                    <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
                      <span>
                        {mrs.department?.department_name}
                        {mrs.requester?.full_name && (
                          <span className="text-slate-500"> · {mrs.requester.full_name}</span>
                        )}
                      </span>
                      <span className="font-mono font-bold text-white">
                        Allocated: ₱{Number(mrs.allocated_budget).toFixed(2)}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right Column: Execution Form */}
        <div className="lg:col-span-8">
          {selectedMRS ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
              {/* Top Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-black text-white">
                      {selectedMRS.mrs_number}
                    </span>
                    <span className="text-xs text-slate-400">
                      ({selectedMRS.department?.department_name})
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Requested by: <span className="text-slate-300 font-semibold">{selectedMRS.requester?.full_name ?? 'Staff'}</span>
                  </p>
                  <p className="text-xs text-slate-300 mt-0.5">{selectedMRS.purpose}</p>
                </div>

                {/* Cash Lock / Status button */}
                {selectedMRS.overall_status !== 'PURCHASING' ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleConfirmCash}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-colors"
                  >
                    <DollarSign className="w-4 h-4" />
                    <span>Confirm Cash Received & Lock Float</span>
                  </button>
                ) : (
                  <span className="px-3 py-1 bg-emerald-950 border border-emerald-800 text-emerald-400 rounded-lg text-xs font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Float Locked / Trip In Progress</span>
                  </span>
                )}
              </div>

              {/* Line Items Checklist */}
              <div className="space-y-4">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                  Purchased Items & Receipt Verification
                </span>

                <div className="space-y-3">
                  {itemsData.map((item, idx) => {
                    const lineRecord = selectedMRS?.mrs_line_items.find(l => l.id === item.lineItemId)
                    return (
                    <div
                      key={item.lineItemId}
                      className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {lineRecord?.reference_photo_url && (
                            <button
                              type="button"
                              onClick={() =>
                                setActivePhoto({
                                  url: lineRecord.reference_photo_url!,
                                  title: item.itemDescription,
                                })
                              }
                              className="relative w-8 h-8 rounded-lg overflow-hidden border border-slate-700 bg-slate-900 shrink-0 group focus:outline-none"
                              title="View requested reference photo"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={lineRecord.reference_photo_url}
                                alt={item.itemDescription}
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                              />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <Eye className="w-3 h-3 text-white" />
                              </div>
                            </button>
                          )}
                          <span className="text-xs font-bold text-white">
                            #{idx + 1}. {item.itemDescription}
                          </span>
                          {lineRecord?.reference_photo_url && (
                            <button
                              type="button"
                              onClick={() =>
                                setActivePhoto({
                                  url: lineRecord.reference_photo_url!,
                                  title: item.itemDescription,
                                })
                              }
                              className="px-1.5 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded text-[10px] font-medium flex items-center gap-1 hover:bg-emerald-900"
                            >
                              <Eye className="w-2.5 h-2.5" /> Sample Photo
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="text-[10px] font-semibold text-slate-400">Status:</label>
                          <select
                            value={item.itemDeliveryStatus}
                            onChange={e =>
                              updateItemData(idx, 'itemDeliveryStatus', e.target.value as ItemDeliveryStatus)
                            }
                            className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-white"
                          >
                            {DELIVERY_STATUSES.map(s => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-slate-400">
                            Purchased Store / Vendor
                          </label>
                          <input
                            type="text"
                            value={item.storeName}
                            onChange={e => updateItemData(idx, 'storeName', e.target.value)}
                            placeholder="Store name"
                            className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-slate-400">
                            Quantity Fulfilled
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={item.qtyFulfilled}
                            onChange={e => updateItemData(idx, 'qtyFulfilled', Number(e.target.value))}
                            className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white text-center font-bold"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-slate-400">
                            Actual Unit Price (₱)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            value={item.actualUnitPrice}
                            onChange={e => updateItemData(idx, 'actualUnitPrice', Number(e.target.value))}
                            className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white font-mono text-right"
                          />
                        </div>
                      </div>

                      {/* Overpriced toggle & Rating & Receipt photo */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs">
                        {/* Rating */}
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 mr-1">Vendor Rating:</span>
                          {[1, 2, 3, 4, 5].map(star => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => updateItemData(idx, 'vendorRating', star)}
                              className="text-amber-400 hover:scale-110 transition-transform"
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${
                                  star <= item.vendorRating ? 'fill-amber-400' : 'text-slate-600'
                                }`}
                              />
                            </button>
                          ))}
                        </div>

                        {/* Overpriced toggle */}
                        <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                          <input
                            type="checkbox"
                            checked={item.isOverpriced}
                            onChange={e => updateItemData(idx, 'isOverpriced', e.target.checked)}
                            className="w-4 h-4 accent-rose-500 rounded"
                          />
                          <span className="text-[11px] font-semibold text-rose-300">
                            Flag Overpriced
                          </span>
                        </label>

                        {/* Receipt photo upload */}
                        <CameraCapture
                          bucket="receipts-proofs"
                          context="PURCHASE_RECEIPT"
                          label="Official Receipt Photo"
                          onUploadComplete={(url: string) => updateItemData(idx, 'receiptPhotoUrl', url)}
                        />
                      </div>
                    </div>
                    )
                  })}
                </div>
              </div>

              {/* Shipping fee & Summary */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">
                    Actual Shipping / Freight Fee (₱)
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={actualShipping}
                    onChange={e => setActualShipping(Number(e.target.value))}
                    className="w-32 px-2.5 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-white font-mono text-right"
                  />
                </div>

                <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Allocated Budget</span>
                    <span className="font-mono font-bold text-white">₱{allocated.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Total Actual Spent</span>
                    <span className="font-mono font-black text-emerald-400">₱{grandTotal.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Spare Change</span>
                    <span className="font-mono font-bold text-blue-400">
                      ₱{variance > 0 ? variance.toFixed(2) : '0.00'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Variance</span>
                    <span className={`font-mono font-bold ${variance < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                      {variance < 0 ? `-₱${Math.abs(variance).toFixed(2)}` : `+₱${variance.toFixed(2)}`}
                    </span>
                  </div>
                </div>

                {isOverBudget && (
                  <div className="p-2.5 bg-amber-950/40 border border-amber-800 rounded-lg text-xs text-amber-200">
                    ⚠️ Total actual spent exceeds allocated budget by ₱{Math.abs(variance).toFixed(2)}. If deficit is minor (≤5% or ≤₱200), supplemental disbursement is auto-approved; otherwise, the order will be flagged as PARTIALLY_FULFILLED_BUDGET_EXHAUSTED.
                  </div>
                )}
              </div>

              {/* Submit Trip */}
              <div className="pt-2 flex items-center justify-end">
                <button
                  type="button"
                  disabled={submitting || grandTotal <= 0}
                  onClick={handleCompleteTrip}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-xl shadow-emerald-500/20 flex items-center gap-2 transition-colors"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  <span>Save Actuals & Forward to Delivery Sign-Off</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-2">
              <ShoppingBag className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-sm font-semibold">Select an approved requisition</p>
              <p className="text-xs text-slate-500">
                You can lock the cash float, enter actual receipts, rate vendors, and flag price inflation.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Photo Lightbox */}
      <PhotoLightbox
        isOpen={Boolean(activePhoto)}
        onClose={() => setActivePhoto(null)}
        imageUrl={activePhoto?.url || null}
        title={activePhoto?.title}
        context="MRS_ITEM_REFERENCE"
      />
    </div>
  )
}
