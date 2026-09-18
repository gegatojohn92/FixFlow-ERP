'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  Star,
  DollarSign,
  Send,
  Eye,
  Truck,
  PackageX,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  purchaserConfirmCash,
  purchaserCompleteTrip,
  reportItemAvailability,
  type PurchaseItemResult,
} from '@/lib/actions/purchaser-actions'
import { markMRSInTransit } from '@/lib/actions/mrs-actions'
import {
  AVAILABILITY_REPORT_STATUSES,
  MRS_STATUSES_FOR_IN_TRANSIT,
  PURCHASER_COMPLETE_TRIP_STATUSES,
  PURCHASER_CONFIRM_CASH_STATUSES,
  MRS_0013_DEFAULTS,
  PG_UNDEFINED_COLUMN,
  REQUESTER_DECISION_LABELS,
  isAwaitingRequesterDecision,
  type RequesterDecision,
} from '@/lib/status-machines'
import CameraCapture from '@/components/shared/CameraCapture'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'
import { useActionLock } from '@/components/ui/ActionLock'
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
  qty_available: number | null
  availability_note: string | null
}

interface MRSPurchaseItem {
  id: number
  mrs_number: string
  purpose: string
  overall_status: string
  allocated_budget: number | null
  est_shipping_fee: number
  actual_shipping_fee: number | null
  is_online_purchase: boolean
  availability_hold: boolean
  availability_notes: string | null
  requester_decision: string
  requester_decision_notes: string | null
  department: { department_name: string } | null
  requester: { full_name: string } | null
  job_order: { jo_number: string; title: string } | null
  mrs_line_items: LineItem[]
}

export default function PurchaserQueuePage() {
  const { runLocked } = useActionLock()
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

  // 0013 — partial availability loop (Form 13 → requester → Form 13)
  const [showAvailabilityPanel, setShowAvailabilityPanel] = useState(false)
  const [availabilityQty, setAvailabilityQty] = useState<Record<number, string>>({})
  const [availabilityNote, setAvailabilityNote] = useState<Record<number, string>>({})
  const [availabilitySummary, setAvailabilitySummary] = useState('')
  // True when migration 0013 has not been applied to this Supabase project.
  const [migrationPending, setMigrationPending] = useState(false)

  const supabase = createClient()

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: qErr } = await supabase
        .from('material_requisitions')
        .select(`
          id, mrs_number, purpose, overall_status, allocated_budget, est_shipping_fee,
          actual_shipping_fee, is_online_purchase,
          availability_hold, availability_notes, requester_decision, requester_decision_notes,
          department:departments(department_name),
          requester:users!material_requisitions_requester_id_fkey(full_name),
          job_order:job_orders!material_requisitions_jo_id_fkey(jo_number, title),
          mrs_line_items(
            id, item_description, qty_requested, qty_issued_from_stock, qty_fulfilled,
            unit, est_unit_price, actual_unit_price, store_name, item_delivery_status,
            vendor_rating, is_overpriced, reference_photo_url, qty_available, availability_note
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

      if (qErr) {
        // Migration 0013 not applied: the availability columns don't exist and
        // PostgREST fails the whole query (42703). Retry without them so the
        // queue still loads (agent_handoff Rule 7).
        if (qErr.code === PG_UNDEFINED_COLUMN) {
          const legacy = await supabase
            .from('material_requisitions')
            .select(`
              id, mrs_number, purpose, overall_status, allocated_budget, est_shipping_fee,
              actual_shipping_fee, is_online_purchase,
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

          if (legacy.error) throw legacy.error
          setMigrationPending(true)
          setQueue(
            ((legacy.data as unknown as MRSPurchaseItem[]) || []).map(row => ({
              ...row,
              ...MRS_0013_DEFAULTS,
              mrs_line_items: (row.mrs_line_items || []).map(li => ({
                ...li,
                qty_available: null,
                availability_note: null,
              })),
            }))
          )
          return
        }
        throw qErr
      }
      setQueue((data as MRSPurchaseItem[]) || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load purchaser queue.')
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
    setShowAvailabilityPanel(false)
    setAvailabilitySummary('')
    setAvailabilityQty(
      Object.fromEntries(
        mrs.mrs_line_items.map(item => [
          item.id,
          String(item.qty_available ?? Math.max(0, item.qty_requested - item.qty_issued_from_stock)),
        ])
      )
    )
    setAvailabilityNote(
      Object.fromEntries(mrs.mrs_line_items.map(item => [item.id, item.availability_note ?? '']))
    )
  }

  // Report a supply shortfall — puts the MRS on hold for the requester (0013)
  const handleReportAvailability = async () => {
    await runLocked('Reporting availability…', async () => {
      if (!selectedMRS) return
      setSubmitting(true)
      setError(null)
      try {
        const res = await reportItemAvailability({
          mrsId: selectedMRS.id,
          items: selectedMRS.mrs_line_items.map(line => ({
            lineItemId: line.id,
            qtyAvailable: Number(availabilityQty[line.id] ?? 0),
            availabilityNote: availabilityNote[line.id],
          })),
          notes: availabilitySummary.trim() || undefined,
        })
        setActionSuccess(
          `Availability reported for ${selectedMRS.mrs_number}. The requester's department has been asked how to proceed: ${res.shortfalls.join('; ')}`
        )
        setShowAvailabilityPanel(false)
        setSelectedMRS(null)
        fetchQueue()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to report item availability.')
      } finally {
        setSubmitting(false)
      }
    })
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
    await runLocked('Confirming cash & locking float…', async () => {
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
    })
  }

  // Mark an online/COD order as shipped (0011 — wires IN_TRANSIT)
  const handleMarkInTransit = async () => {
    await runLocked('Marking in transit…', async () => {
      if (!selectedMRS) return
      setSubmitting(true)
      setError(null)
      try {
        await markMRSInTransit(selectedMRS.id, 'Online order shipped per purchaser.')
        setActionSuccess(`Order ${selectedMRS.mrs_number} marked IN TRANSIT — awaiting requester sign-off.`)
        setSelectedMRS(prev => (prev ? { ...prev, overall_status: 'IN_TRANSIT' } : null))
        fetchQueue()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to mark requisition in transit.')
      } finally {
        setSubmitting(false)
      }
    })
  }

  // ── Trip-save gate (0012 strict chain) ──────────────────────────────────
  // Saving actuals & forwarding to delivery sign-off is gated by exactly the
  // same chain as the cash lock: Accounting must disburse AND mark the
  // transmittal SENT (Form 11) — which is what advances the MRS into
  // PURCHASING — before a purchaser may forward a trip. Emergency Fast-Track is
  // the one documented bypass (no transmittal by design, Plan §6.A).
  // Uses PURCHASER_COMPLETE_TRIP_STATUSES, the same list purchaserCompleteTrip()
  // re-validates server-side, so the UI can never offer a step the DB rejects.
  const selectedStatus = selectedMRS?.overall_status

  // 0013 Gate A — an unanswered (or WAIT_FULL) availability hold freezes the
  // forward step exactly as purchaserCompleteTrip() and the DB guard do.
  const awaitingRequester = !!selectedMRS && isAwaitingRequesterDecision(selectedMRS)
  const waitingForFullStock =
    !!selectedMRS && selectedMRS.availability_hold && selectedMRS.requester_decision === 'WAIT_FULL'
  const availabilityBlocked = awaitingRequester || waitingForFullStock

  const canCompleteTrip =
    !!selectedStatus &&
    (PURCHASER_COMPLETE_TRIP_STATUSES as readonly string[]).includes(selectedStatus) &&
    !availabilityBlocked

  const canReportAvailability =
    !migrationPending &&
    !!selectedStatus &&
    (AVAILABILITY_REPORT_STATUSES as readonly string[]).includes(selectedStatus) &&
    !awaitingRequester

  const tripLockReason = awaitingRequester
    ? 'Availability hold — awaiting the requester\u2019s decision (Form 9)'
    : waitingForFullStock
      ? 'Requester chose to WAIT for full availability — do not buy a partial quantity'
      : selectedStatus === 'APPROVED_READY_TO_ORDER' || selectedStatus === 'TRANSMITTAL_IN_PROGRESS'
        ? 'Waiting for Accounting — Disburse & Mark Sent (Form 11)'
        : selectedStatus === 'READY_FOR_PURCHASE'
          ? 'Confirm Cash Received & Lock Float first (Form 13)'
          : 'Not releasable for purchasing yet'

  // Complete Trip and Record Actuals
  const handleCompleteTrip = async () => {
    await runLocked('Saving actuals & forwarding…', async () => {
      if (!selectedMRS) return
      // Defence in depth: block a stale render / programmatic submit as well.
      if (!canCompleteTrip) {
        setError(`${tripLockReason}. Actuals cannot be saved for a requisition in "${selectedStatus}".`)
        return
      }
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
    })
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

      {migrationPending && (
        <div className="p-3.5 bg-amber-950/40 border border-amber-800 rounded-xl text-xs text-amber-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Availability reporting is unavailable — migration{' '}
            <span className="font-mono">0013_availability_and_spare_change_gates.sql</span> has not been
            applied to this Supabase project yet.
          </span>
        </div>
      )}

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
                        <Link href={`/audit-logs/material_requisition/${mrs.id}`} className="hover:text-cyan-300" title="View audit history">{mrs.mrs_number}</Link>
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

                {/* Cash Lock / Status button — 0012 strict chain: the button
                    only appears once Accounting has disbursed & marked the
                    transmittal SENT (READY_FOR_PURCHASE) or on the
                    Emergency Fast-Track path (no transmittal by design). */}
                {(PURCHASER_CONFIRM_CASH_STATUSES as readonly string[]).includes(selectedMRS.overall_status) ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleConfirmCash}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-colors"
                  >
                    <DollarSign className="w-4 h-4" />
                    <span>Confirm Cash Received & Lock Float</span>
                  </button>
                ) : selectedMRS.overall_status === 'APPROVED_READY_TO_ORDER' || selectedMRS.overall_status === 'TRANSMITTAL_IN_PROGRESS' ? (
                  <span className="px-3 py-1 bg-amber-950 border border-amber-800 text-amber-300 rounded-lg text-xs font-bold flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Waiting for Accounting — Disburse & Mark Sent (Form 11)</span>
                  </span>
                ) : (
                  <span className="px-3 py-1 bg-emerald-950 border border-emerald-800 text-emerald-400 rounded-lg text-xs font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Float Locked / Trip In Progress</span>
                  </span>
                )}

                {/* Mark In Transit — online/COD orders (0011) */}
                {selectedMRS.is_online_purchase &&
                  (MRS_STATUSES_FOR_IN_TRANSIT as readonly string[]).includes(selectedMRS.overall_status) && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleMarkInTransit}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-indigo-500/20 transition-colors"
                    >
                      <Truck className="w-4 h-4" />
                      <span>Mark In Transit (Shipped)</span>
                    </button>
                  )}
              </div>

              {/* 0013 — Availability hold banner & requester decision */}
              {selectedMRS.availability_hold && (
                <div className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                  awaitingRequester
                    ? 'bg-amber-950/40 border-amber-800 text-amber-200'
                    : 'bg-rose-950/40 border-rose-800 text-rose-200'
                }`}>
                  <div className="flex items-center gap-2 font-bold">
                    <PackageX className="w-4 h-4 shrink-0" />
                    <span>
                      {awaitingRequester
                        ? 'Availability reported — awaiting the requester\u2019s decision'
                        : REQUESTER_DECISION_LABELS[selectedMRS.requester_decision as RequesterDecision] ??
                          selectedMRS.requester_decision}
                    </span>
                  </div>
                  {selectedMRS.availability_notes && (
                    <p className="text-[11px] opacity-90">{selectedMRS.availability_notes}</p>
                  )}
                  {selectedMRS.requester_decision_notes && (
                    <p className="text-[11px] opacity-90">
                      Requester: {selectedMRS.requester_decision_notes}
                    </p>
                  )}
                </div>
              )}

              {!selectedMRS.availability_hold &&
                selectedMRS.requester_decision !== 'NONE' &&
                selectedMRS.requester_decision !== 'PENDING' && (
                  <div className="p-3.5 bg-emerald-950/40 border border-emerald-800 rounded-xl text-xs text-emerald-200 space-y-1">
                    <div className="flex items-center gap-2 font-bold">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Requester decision:{' '}
                        {REQUESTER_DECISION_LABELS[selectedMRS.requester_decision as RequesterDecision] ??
                          selectedMRS.requester_decision}
                      </span>
                    </div>
                    <p className="text-[11px] opacity-90">
                      Buy only the quantities reported available — the form caps each line at that amount.
                    </p>
                  </div>
                )}

              {/* Report Availability — opens the shortfall reporting panel */}
              {canReportAvailability && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowAvailabilityPanel(v => !v)}
                    className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    <PackageX className="w-4 h-4" />
                    <span>
                      {showAvailabilityPanel ? 'Close Availability Report' : 'Item Unavailable / Short Supply'}
                    </span>
                  </button>
                </div>
              )}

              {showAvailabilityPanel && canReportAvailability && (
                <div className="p-4 bg-amber-950/20 border border-amber-800/70 rounded-xl space-y-3">
                  <div>
                    <span className="text-xs font-bold text-amber-200 block">
                      Report What the Supplier Can Actually Provide
                    </span>
                    <p className="text-[11px] text-amber-300/80 mt-0.5">
                      Enter the quantity available for each line. The requisition is put on hold and the
                      requester&apos;s department decides whether to proceed with the available quantity,
                      wait for full stock, or cancel the balance. You cannot save actuals until they answer.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {selectedMRS.mrs_line_items.map(line => {
                      const outstanding = Math.max(0, line.qty_requested - line.qty_issued_from_stock)
                      const entered = Number(availabilityQty[line.id] ?? outstanding)
                      const short = entered < outstanding
                      return (
                        <div
                          key={line.id}
                          className="p-3 bg-slate-950 border border-slate-800 rounded-lg grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                        >
                          <div className="sm:col-span-5">
                            <span className="text-xs font-semibold text-white block">
                              {line.item_description}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              Outstanding: {outstanding} {line.unit}
                            </span>
                          </div>
                          <div className="sm:col-span-3">
                            <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                              Qty Available
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={outstanding}
                              value={availabilityQty[line.id] ?? ''}
                              onChange={e =>
                                setAvailabilityQty(prev => ({ ...prev, [line.id]: e.target.value }))
                              }
                              className={`w-full px-2.5 py-1.5 bg-slate-900 border rounded text-xs text-white text-center font-bold ${
                                short ? 'border-amber-600' : 'border-slate-700'
                              }`}
                            />
                          </div>
                          <div className="sm:col-span-4">
                            <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                              Reason / Note
                            </label>
                            <input
                              type="text"
                              maxLength={255}
                              value={availabilityNote[line.id] ?? ''}
                              onChange={e =>
                                setAvailabilityNote(prev => ({ ...prev, [line.id]: e.target.value }))
                              }
                              placeholder="e.g. out of stock, last 2 pcs"
                              className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white"
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400">
                      Summary for the Requester (optional)
                    </label>
                    <textarea
                      rows={2}
                      value={availabilitySummary}
                      onChange={e => setAvailabilitySummary(e.target.value)}
                      placeholder="Describe the supply situation and any alternatives you found..."
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleReportAvailability}
                      className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center gap-2 transition-colors"
                    >
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageX className="w-4 h-4" />}
                      <span>Notify Requester & Hold Purchase</span>
                    </button>
                  </div>
                </div>
              )}

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
                            {lineRecord?.qty_available !== null && lineRecord?.qty_available !== undefined && (
                              <span className="ml-1 text-amber-400 font-bold">
                                (max {lineRecord.qty_available} available)
                              </span>
                            )}
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={lineRecord?.qty_available ?? undefined}
                            value={item.qtyFulfilled}
                            onChange={e => updateItemData(idx, 'qtyFulfilled', Number(e.target.value))}
                            className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white text-center font-bold"
                          />
                          {lineRecord?.availability_note && (
                            <p className="text-[10px] text-amber-400/90">{lineRecord.availability_note}</p>
                          )}
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

              {/* Submit Trip — locked until Accounting has disbursed & marked
                  the transmittal SENT (same chain as the cash-lock button). */}
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
                {canCompleteTrip ? (
                  <button
                    type="button"
                    disabled={submitting || grandTotal <= 0}
                    onClick={handleCompleteTrip}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-xl shadow-emerald-500/20 flex items-center gap-2 transition-colors"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    <span>Save Actuals & Forward to Delivery Sign-Off</span>
                  </button>
                ) : (
                  <>
                    <span className="text-[11px] text-slate-500 sm:text-right">
                      Vendor, quantity and receipt entries can be filled in now — only the forward step
                      unlocks once the cash float is locked.
                    </span>
                    <span className="px-3 py-2 bg-amber-950 border border-amber-800 text-amber-300 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 shrink-0" />
                      <span>{tripLockReason}</span>
                    </span>
                  </>
                )}
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
