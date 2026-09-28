'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  FileSearch,
  Share2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  AlertCircle,
  Eye,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { recordCanvassPricing, recordOwnerDecision } from '@/lib/actions/mrs-actions'
import { SnapshotGenerator, type CanvassSnapshotData } from '@/components/messenger/SnapshotGenerator'
import { useActionLock } from '@/components/ui/ActionLock'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'

interface LineItem {
  id: number
  item_description: string
  qty_requested: number
  qty_issued_from_stock: number
  unit: string
  est_unit_price: number
  store_name: string | null
  reference_photo_url: string | null
}

interface CatalogPrice {
  item_description: string
  store_name: string
  last_unit_price: number
  is_overpriced_flag: boolean
}

interface MRSCanvassItem {
  id: number
  mrs_number: string
  purpose: string
  created_at: string
  overall_status: string
  total_estimated_cost: number
  allocated_budget: number | null
  est_shipping_fee: number
  department: { department_name: string } | null
  requester: { full_name: string } | null
  job_order: { jo_number: string; title: string } | null
  mrs_line_items: LineItem[]
}

export default function CanvassMRSPage() {
  const { runLocked } = useActionLock()
  const [queue, setQueue] = useState<MRSCanvassItem[]>([])
  const [catalog, setCatalog] = useState<CatalogPrice[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMRS, setSelectedMRS] = useState<MRSCanvassItem | null>(null)
  const [activePhoto, setActivePhoto] = useState<{ url: string; title: string } | null>(null)

  // Canvassing inputs state
  const [canvassedItems, setCanvassedItems] = useState<
    Array<{ lineItemId: number; storeName: string; estUnitPrice: number }>
  >([])

  // Modal / Snapshot states
  const [showSnapshotModal, setShowSnapshotModal] = useState(false)
  const [snapshotData, setSnapshotData] = useState<CanvassSnapshotData | null>(null)
  const [showDecisionModal, setShowDecisionModal] = useState(false)
  const [decisionType, setDecisionType] = useState<'APPROVED' | 'REJECTED'>('APPROVED')
  const [decisionReason, setDecisionReason] = useState('')
  const [approvedBudget, setApprovedBudget] = useState<number>(0)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const supabase = createClient()

  const fetchData = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: mrsData, error: qErr } = await supabase
        .from('material_requisitions')
        .select(`
          id, mrs_number, purpose, created_at, overall_status, total_estimated_cost,
          allocated_budget, est_shipping_fee,
          department:departments(department_name),
          requester:users!material_requisitions_requester_id_fkey(full_name),
          job_order:job_orders!material_requisitions_jo_id_fkey(jo_number, title),
          mrs_line_items(id, item_description, qty_requested, qty_issued_from_stock, unit, est_unit_price, store_name, reference_photo_url)
        `)
        .in('overall_status', ['IN_CANVASSING', 'PENDING_OWNER'])
        .order('created_at', { ascending: true })

      if (qErr) throw qErr
      const rows = (mrsData as MRSCanvassItem[]) || []
      setQueue(rows)

      // Re-point the open requisition at its refreshed row so derived gates
      // (snapshotSent / pricingLocked) see the new overall_status immediately.
      setSelectedMRS(prev => (prev ? rows.find(r => r.id === prev.id) ?? null : null))

      const { data: catData } = await supabase
        .from('item_price_catalog')
        .select('item_description, store_name, last_unit_price, is_overpriced_flag')

      if (catData) setCatalog(catData)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load canvassing queue.')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [fetchData])

  const handleSelectMRS = (mrs: MRSCanvassItem) => {
    setSelectedMRS(mrs)
    const initial = mrs.mrs_line_items.map(item => {
      // Check if item exists in catalog
      const catMatch = catalog.find(
        c => c.item_description.toLowerCase() === item.item_description.toLowerCase()
      )
      return {
        lineItemId: item.id,
        storeName: item.store_name || catMatch?.store_name || '',
        estUnitPrice: item.est_unit_price || catMatch?.last_unit_price || 0,
      }
    })
    setCanvassedItems(initial)
  }

  const updateCanvassItem = (
    lineItemId: number,
    field: 'storeName' | 'estUnitPrice',
    value: string | number
  ) => {
    setCanvassedItems(prev =>
      prev.map(item =>
        item.lineItemId === lineItemId ? { ...item, [field]: value } : item
      )
    )
  }

  // Calculate total canvassed budget
  const calculateTotalBudget = () => {
    if (!selectedMRS) return 0
    let sum = Number(selectedMRS.est_shipping_fee) || 0
    selectedMRS.mrs_line_items.forEach(lineItem => {
      const canvassed = canvassedItems.find(c => c.lineItemId === lineItem.id)
      const toProcure = Math.max(0, lineItem.qty_requested - lineItem.qty_issued_from_stock)
      const price = canvassed ? Number(canvassed.estUnitPrice) || 0 : 0
      sum += toProcure * price
    })
    return sum
  }

  // Items still to procure that lack a supplier or a positive price.
  // The server action (0011) enforces the same rule; this keeps the form
  // honest so the Budget Officer sees the gap before clicking.
  const unpricedItemDescriptions = selectedMRS
    ? selectedMRS.mrs_line_items
        .filter(lineItem => {
          const toProcure = Math.max(0, lineItem.qty_requested - lineItem.qty_issued_from_stock)
          if (toProcure <= 0) return false
          const canvassed = canvassedItems.find(c => c.lineItemId === lineItem.id)
          return !canvassed || !canvassed.storeName.trim() || !(Number(canvassed.estUnitPrice) > 0)
        })
        .map(lineItem => lineItem.item_description)
    : []
  const canvassComplete = unpricedItemDescriptions.length === 0

  // The Messenger snapshot step calls recordCanvassPricing(), which commits the
  // prices and moves the requisition IN_CANVASSING → PENDING_OWNER. So the
  // status itself is the durable record of "snapshot generated" — it survives a
  // refresh or a different device, unlike a local useState flag.
  //
  // Once PENDING_OWNER: prices are locked (the server action rejects any
  // further edit anyway, since it requires IN_CANVASSING), the snapshot button
  // is spent, and the Owner decision may finally be logged.
  const snapshotSent = selectedMRS?.overall_status === 'PENDING_OWNER'
  const pricingLocked = snapshotSent

  // Generate Snapshot for Owner approval
  const handlePrepareSnapshot = async () => {
    await runLocked('Saving canvass pricing…', async () => {
      if (!selectedMRS) return
      const total = calculateTotalBudget()
      setSubmitting(true)
      setError(null)

      try {
        // Save updated canvass pricing first
        const result = await recordCanvassPricing({
          mrsId: selectedMRS.id,
          items: canvassedItems,
          totalCanvassedBudget: total,
        })
        if (!result.success) {
          setError(result.error)
          return
        }

        // Prepare snapshot data
        const itemsSnapshot = selectedMRS.mrs_line_items.map(item => {
          const canvassed = canvassedItems.find(c => c.lineItemId === item.id)
          const toProcure = Math.max(0, item.qty_requested - item.qty_issued_from_stock)
          const catMatch = catalog.find(
            c =>
              c.item_description.toLowerCase() === item.item_description.toLowerCase() &&
              c.store_name.toLowerCase() === (canvassed?.storeName || '').toLowerCase()
          )
          return {
            description: item.item_description,
            quantity: toProcure,
            unit: item.unit,
            supplier: canvassed?.storeName || 'TBD',
            unitPrice: canvassed ? Number(canvassed.estUnitPrice) || 0 : 0,
            isOverpriced: catMatch?.is_overpriced_flag ?? false,
          }
        })

        const data: CanvassSnapshotData = {
          mrsNumber: selectedMRS.mrs_number,
          joNumber: selectedMRS.job_order?.jo_number,
          department: selectedMRS.department?.department_name || 'General',
          requesterName: selectedMRS.requester?.full_name || 'Staff',
          purpose: selectedMRS.purpose,
          date: new Date().toLocaleDateString('en-PH', { dateStyle: 'medium' }),
          totalBudget: total,
          items: itemsSnapshot,
        }

        setSnapshotData(data)
        setShowSnapshotModal(true)
        // Awaited: the refresh is what flips overall_status to PENDING_OWNER
        // on the selected row, which is what locks the price inputs and
        // enables the Owner-decision button.
        await fetchData()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to prepare snapshot.')
      } finally {
        setSubmitting(false)
      }
    })
  }

  // Record Owner Decision
  const handleRecordDecision = async () => {
    await runLocked('Recording owner decision…', async () => {
      if (!selectedMRS) return
      if (decisionType === 'REJECTED' && !decisionReason.trim()) {
        setError('Please provide the Owner rejection reason.')
        return
      }

      setSubmitting(true)
      setError(null)

      try {
        const result = await recordOwnerDecision({
          mrsId: selectedMRS.id,
          decision: decisionType,
          rejectionReason: decisionType === 'REJECTED' ? decisionReason.trim() : undefined,
          allocatedBudget: decisionType === 'APPROVED' ? approvedBudget : undefined,
        })
        if (!result.success) {
          setError(result.error)
          return
        }

        setSuccessMessage(
          decisionType === 'APPROVED'
            ? `Owner APPROVED recorded for ${selectedMRS.mrs_number}! Allocated budget: ₱${approvedBudget.toFixed(2)}. Ready for Transmittal.`
            : `Owner REJECTED recorded for ${selectedMRS.mrs_number}. Reason saved.`
        )

        setShowDecisionModal(false)
        setSelectedMRS(null)
        await fetchData()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to record Owner decision.')
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
            <FileSearch className="w-6 h-6 text-purple-400" />
            <h1 className="text-xl font-black text-white tracking-tight">
              Procurement Canvassing & Owner Approval
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Form 8 — Budget Officer portal: Price canvassing, Messenger snapshots, and Owner decision logging.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-purple-950/60 border border-purple-800/80 rounded-lg text-xs font-bold text-purple-300">
            {queue.length} Active in Canvassing Pipeline
          </span>
        </div>
      </div>

      {successMessage && (
        <div className="p-3.5 bg-emerald-950/40 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <Link
            href="/transmittals/create"
            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition-colors"
          >
            Create Transmittal
          </Link>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-950/40 border border-red-800 rounded-xl text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left column: Queue list */}
        <div className="lg:col-span-5 space-y-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
            Select Requisition to Canvass
          </span>

          {loading ? (
            <div className="py-12 text-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-purple-500 mx-auto mb-2" />
              <span className="text-xs">Loading requisitions...</span>
            </div>
          ) : queue.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400">
              No requisitions awaiting canvassing.
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
                        ? 'bg-purple-950/30 border-purple-600 shadow-lg shadow-purple-900/20'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-black text-purple-400">
                        {mrs.mrs_number}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        mrs.overall_status === 'PENDING_OWNER'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-purple-950 text-purple-300 border border-purple-800'
                      }`}>
                        {mrs.overall_status === 'PENDING_OWNER' ? 'Pending Owner' : 'In Canvassing'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-200 mt-2 line-clamp-1 font-semibold">
                      {mrs.purpose}
                    </p>

                    <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
                      <span>
                        {mrs.department?.department_name ?? 'General'}
                        {mrs.requester?.full_name && (
                          <span className="text-slate-500"> · {mrs.requester.full_name}</span>
                        )}
                      </span>
                      <span className="font-mono font-bold text-slate-300">
                        ₱{Number(mrs.allocated_budget || mrs.total_estimated_cost).toFixed(2)}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right column: Canvassing workspace */}
        <div className="lg:col-span-7">
          {selectedMRS ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
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
                  <p className="text-xs text-slate-300 mt-1">{selectedMRS.purpose}</p>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                    Total Canvassed Budget
                  </span>
                  <span className="text-xl font-black font-mono text-purple-400">
                    ₱{calculateTotalBudget().toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Items Canvassing Table */}
              <div className="space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                  Verify Vendor Pricing & Quotes
                </span>

                <div className="space-y-3">
                  {selectedMRS.mrs_line_items.map(lineItem => {
                    const toProcure = Math.max(0, lineItem.qty_requested - lineItem.qty_issued_from_stock)
                    const canvassed = canvassedItems.find(c => c.lineItemId === lineItem.id)
                    const catMatch = catalog.find(
                      c =>
                        c.item_description.toLowerCase() === lineItem.item_description.toLowerCase() &&
                        c.store_name.toLowerCase() === (canvassed?.storeName || '').toLowerCase()
                    )
                    const isOverpriced = catMatch?.is_overpriced_flag ?? false

                    return (
                      <div
                        key={lineItem.id}
                        className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {lineItem.reference_photo_url && (
                              <button
                                type="button"
                                onClick={() =>
                                  setActivePhoto({
                                    url: lineItem.reference_photo_url!,
                                    title: lineItem.item_description,
                                  })
                                }
                                className="relative w-8 h-8 rounded-lg overflow-hidden border border-slate-700 bg-slate-900 shrink-0 group focus:outline-none"
                                title="View reference photo"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={lineItem.reference_photo_url}
                                  alt={lineItem.item_description}
                                  className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                  <Eye className="w-3 h-3 text-white" />
                                </div>
                              </button>
                            )}
                            <span className="text-xs font-bold text-white">
                              {lineItem.item_description}
                            </span>
                            {lineItem.reference_photo_url && (
                              <button
                                type="button"
                                onClick={() =>
                                  setActivePhoto({
                                    url: lineItem.reference_photo_url!,
                                    title: lineItem.item_description,
                                  })
                                }
                                className="px-1.5 py-0.5 bg-purple-950 text-purple-300 border border-purple-800 rounded text-[10px] font-medium flex items-center gap-1 hover:bg-purple-900"
                              >
                                <Eye className="w-2.5 h-2.5" /> View Photo
                              </button>
                            )}
                            {isOverpriced && (
                              <span className="px-2 py-0.5 bg-rose-950/80 border border-rose-800 text-rose-300 text-[10px] font-bold rounded flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-rose-400" />
                                <span>Historically Overpriced</span>
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-400">
                            Quantity needed: <strong className="text-white">{toProcure} {lineItem.unit}</strong>
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-semibold">
                              Canvassed Supplier / Store
                            </label>
                            <input
                              type="text"
                              value={canvassed?.storeName || ''}
                              onChange={e =>
                                updateCanvassItem(lineItem.id, 'storeName', e.target.value)
                              }
                              readOnly={pricingLocked}
                              disabled={pricingLocked}
                              title={
                                pricingLocked
                                  ? 'Locked — the snapshot has been sent to the Owner for approval.'
                                  : undefined
                              }
                              placeholder="e.g. Ace Hardware"
                              className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-semibold">
                              Canvassed Unit Price (₱)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min={0}
                              value={canvassed?.estUnitPrice || ''}
                              onChange={e =>
                                updateCanvassItem(lineItem.id, 'estUnitPrice', Number(e.target.value))
                              }
                              readOnly={pricingLocked}
                              disabled={pricingLocked}
                              title={
                                pricingLocked
                                  ? 'Locked — the snapshot has been sent to the Owner for approval.'
                                  : undefined
                              }
                              className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-mono text-right disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Unpriced Items Gate (0011) */}
              {!canvassComplete && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-xl text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {unpricedItemDescriptions.length} item(s) still need a supplier and a positive
                    canvassed price before Owner approval:{' '}
                    <b>{unpricedItemDescriptions.join(', ')}</b>
                  </span>
                </div>
              )}

              {/* Sequence notice — the snapshot must precede the decision. */}
              {snapshotSent ? (
                <div className="p-3 bg-purple-950/40 border border-purple-800/60 rounded-xl flex items-start gap-2">
                  <Share2 className="w-3.5 h-3.5 text-purple-300 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-purple-200">
                    Snapshot sent to the Owner — canvassed prices are now locked. Log the Owner&apos;s
                    decision once it comes back.
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-slate-400">
                    Generate the Messenger snapshot and send it to the Owner before logging a
                    decision. Generating it commits these prices and locks them from further edits.
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={submitting || !canvassComplete || snapshotSent}
                  onClick={handlePrepareSnapshot}
                  title={
                    snapshotSent
                      ? 'Already generated — the snapshot has been sent to the Owner.'
                      : !canvassComplete
                        ? 'Every item still to procure needs a supplier and a positive price.'
                        : undefined
                  }
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-500/20 transition-colors"
                >
                  {snapshotSent ? <CheckCircle2 className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                  <span>{snapshotSent ? 'Snapshot Sent' : 'Generate Messenger Snapshot'}</span>
                </button>

                {/* Re-open the snapshot for re-sending without re-committing prices. */}
                {snapshotSent && snapshotData && (
                  <button
                    type="button"
                    onClick={() => setShowSnapshotModal(true)}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    <span>View Snapshot</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={!canvassComplete || !snapshotSent}
                  onClick={() => {
                    const total = calculateTotalBudget()
                    setApprovedBudget(total)
                    setShowDecisionModal(true)
                  }}
                  title={
                    !snapshotSent
                      ? 'Generate and send the Messenger snapshot to the Owner first.'
                      : undefined
                  }
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Log Owner Decision</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-2">
              <FileSearch className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-sm font-semibold">Select a requisition from the list</p>
              <p className="text-xs text-slate-500">
                You can review catalog suggestions, edit vendor quotes, and prepare executive snapshots.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Snapshot Modal */}
      {showSnapshotModal && snapshotData && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Messenger / WhatsApp Snapshot</h3>
                <p className="text-xs text-slate-400">
                  Ready to copy or export for off-platform executive approval
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSnapshotModal(false)}
                className="text-slate-400 hover:text-white text-xs font-bold px-2 py-1 bg-slate-800 rounded"
              >
                Done
              </button>
            </div>

            <SnapshotGenerator data={snapshotData} />
          </div>
        </div>
      )}

      {/* Owner Decision Modal */}
      {showDecisionModal && selectedMRS && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-white">
              Record Owner Reply for {selectedMRS.mrs_number}
            </h3>
            <p className="text-xs text-slate-400">
              Log the off-platform reply received from Owner via Messenger or WhatsApp.
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setDecisionType('APPROVED')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-1.5 ${
                  decisionType === 'APPROVED'
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-500/20'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>APPROVED</span>
              </button>

              <button
                type="button"
                onClick={() => setDecisionType('REJECTED')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-1.5 ${
                  decisionType === 'REJECTED'
                    ? 'bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-500/20'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                }`}
              >
                <XCircle className="w-4 h-4" />
                <span>REJECTED</span>
              </button>
            </div>

            {decisionType === 'APPROVED' ? (
              <div className="space-y-1 pt-2">
                <label className="text-[10px] font-semibold text-slate-400">
                  Approved Allocated Budget (₱)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={approvedBudget}
                  onChange={e => setApprovedBudget(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm font-mono font-bold text-white text-right"
                />
              </div>
            ) : (
              <div className="space-y-1 pt-2">
                <label className="text-[10px] font-semibold text-rose-400">
                  Owner Rejection Notes *
                </label>
                <textarea
                  required
                  rows={3}
                  value={decisionReason}
                  onChange={e => setDecisionReason(e.target.value)}
                  placeholder="Record reason given by Owner..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500"
                />
              </div>
            )}

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDecisionModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={handleRecordDecision}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg transition-colors flex items-center gap-1.5"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>Save Decision</span>
              </button>
            </div>
          </div>
        </div>
      )}

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
