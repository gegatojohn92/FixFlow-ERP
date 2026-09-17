'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  PackageCheck,
  CheckCircle2,
  AlertOctagon,
  AlertCircle,
  Loader2,
  Building,
  FileText,
  RotateCcw,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { verifyDeliveryRequester } from '@/lib/actions/purchaser-actions'

interface LineItem {
  id: number
  item_description: string
  qty_requested: number
  qty_issued_from_stock: number
  qty_fulfilled: number
  unit: string
  actual_unit_price: number
  store_name: string | null
  item_delivery_status: string
  reference_photo_url: string | null
}

interface MRSVerificationItem {
  id: number
  mrs_number: string
  purpose: string
  overall_status: string
  total_actual_spent: number
  allocated_budget: number
  requester_verification: string
  department: { department_name: string } | null
  job_order: { id: number; jo_number: string; title: string; status: string } | null
  mrs_line_items: LineItem[]
}

export default function DeliveryVerifyPage() {
  const [list, setList] = useState<MRSVerificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMRS, setSelectedMRS] = useState<MRSVerificationItem | null>(null)
  const [disputeNotes, setDisputeNotes] = useState('')
  const [showDisputeModal, setShowDisputeModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const supabase = createClient()

  const fetchRequisitions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Requisitions with items purchased/delivered awaiting verification or recently fulfilled
      const { data, error: qErr } = await supabase
        .from('material_requisitions')
        .select(`
          id, mrs_number, purpose, overall_status, total_actual_spent, allocated_budget,
          requester_verification,
          department:departments(department_name),
          job_order:job_orders!material_requisitions_jo_id_fkey(id, jo_number, title, status),
          mrs_line_items(
            id, item_description, qty_requested, qty_issued_from_stock, qty_fulfilled,
            unit, actual_unit_price, store_name, item_delivery_status, reference_photo_url
          )
        `)
        .in('overall_status', [
          'FULFILLED',
          'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED',
          'DISPUTED',
        ])
        .order('id', { ascending: false })

      if (qErr) throw qErr
      setList((data as MRSVerificationItem[]) || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load delivery verification items.')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchRequisitions()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [fetchRequisitions])

  const handleConfirmVerified = async (mrs: MRSVerificationItem) => {
    setSubmitting(true)
    setError(null)
    try {
      await verifyDeliveryRequester({
        mrsId: mrs.id,
        verified: true,
      })
      setSuccessMessage(
        `Requisition ${mrs.mrs_number} verified! Linked Job Order updated to MATERIALS_RECEIVED.`
      )
      void fetchRequisitions()
      if (selectedMRS?.id === mrs.id) setSelectedMRS(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to verify delivery.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmDispute = async () => {
    if (!selectedMRS || !disputeNotes.trim()) {
      setError('Please provide specific dispute notes describing the discrepancy or missing items.')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await verifyDeliveryRequester({
        mrsId: selectedMRS.id,
        verified: false,
        verificationNotes: disputeNotes.trim(),
      })
      setSuccessMessage(`Dispute logged for ${selectedMRS.mrs_number}. Alerts sent to Manager & Purchaser.`)
      setShowDisputeModal(false)
      setSelectedMRS(null)
      void fetchRequisitions()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to file dispute.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <PackageCheck className="w-6 h-6 text-emerald-400" />
            <h1 className="text-xl font-black text-white tracking-tight">
              Delivery Verification & Requester Sign-Off
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Form 14 — Confirm physical receipt of purchased items, dispute shortfalls, or re-request skipped items.
          </p>
        </div>
      </div>

      {successMessage && (
        <div className="p-3.5 bg-emerald-950/40 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-950/40 border border-red-800 rounded-xl text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Grid of requisitions */}
      {loading ? (
        <div className="py-20 text-center text-slate-400 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mr-3" />
          <span>Loading delivery verification orders...</span>
        </div>
      ) : list.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-2">
          <PackageCheck className="w-8 h-8 mx-auto text-slate-600" />
          <p className="text-sm font-semibold">No Pending Deliveries</p>
          <p className="text-xs text-slate-500">
            All purchased requisitions have already been inspected and signed off.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map(mrs => {
            const isVerified = mrs.requester_verification === 'VERIFIED'
            const isDisputed = mrs.overall_status === 'DISPUTED'
            const hasSkippedItems = mrs.mrs_line_items.some(
              i => i.item_delivery_status === 'BUDGET_EXHAUSTED' || i.item_delivery_status === 'UNAVAILABLE'
            )

            return (
              <div
                key={mrs.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 hover:border-slate-700 transition-colors"
              >
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-black text-white">
                        {mrs.mrs_number}
                      </span>
                      {isVerified ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                          Sign-Off Complete
                        </span>
                      ) : isDisputed ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800">
                          Delivery Disputed
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                          Pending Physical Verification
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <Building className="w-3.5 h-3.5" />
                      <span>{mrs.department?.department_name}</span>
                      <span>•</span>
                      <span>{mrs.purpose}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                      Actual Spent
                    </span>
                    <span className="text-base font-black font-mono text-emerald-400">
                      ₱{Number(mrs.total_actual_spent).toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Linked JO Banner */}
                {mrs.job_order && (
                  <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-400" />
                      <span className="text-slate-400">Linked Job Order:</span>
                      <span className="font-mono font-bold text-white">{mrs.job_order.jo_number}</span>
                      <span className="text-slate-300 truncate max-w-xs">({mrs.job_order.title})</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-blue-950 text-blue-300 text-[10px] font-bold border border-blue-900">
                      JO Status: {mrs.job_order.status}
                    </span>
                  </div>
                )}

                {/* Items Breakdown */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                    Delivered Items Breakdown:
                  </span>
                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    {mrs.mrs_line_items.map(item => (
                      <div
                        key={item.id}
                        className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="space-y-0.5">
                          <span className="font-semibold text-slate-200 block">
                            {item.item_description}
                          </span>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400">
                            <span>Req: {item.qty_requested} {item.unit}</span>
                            <span className="text-emerald-400 font-bold">
                              Fulfilled: {item.qty_fulfilled} {item.unit}
                            </span>
                            {item.store_name && <span>Vendor: {item.store_name}</span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            item.item_delivery_status === 'DELIVERED'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-rose-950 text-rose-300 border border-rose-800'
                          }`}>
                            {item.item_delivery_status}
                          </span>
                          <span className="font-mono font-bold text-white">
                            ₱{(item.qty_fulfilled * Number(item.actual_unit_price)).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    {hasSkippedItems && (
                      <Link
                        href={`/mrs/new?re_request_mrs=${mrs.id}`}
                        className="px-3.5 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Re-Request Skipped Items (Form 5)</span>
                      </Link>
                    )}
                  </div>

                  {!isVerified && (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMRS(mrs)
                          setDisputeNotes('')
                          setShowDisputeModal(true)
                        }}
                        className="px-4 py-2 bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                      >
                        <AlertOctagon className="w-4 h-4" />
                        <span>Mark Disputed / Incomplete</span>
                      </button>

                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleConfirmVerified(mrs)}
                        className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-colors"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Mark Done / Verified</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Dispute Modal */}
      {showDisputeModal && selectedMRS && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-white">
              Dispute Delivery for {selectedMRS.mrs_number}
            </h3>
            <p className="text-xs text-slate-300">
              Filing a dispute marks the requisition as <strong>DISPUTED</strong> and flags both the Manager and Purchaser for immediate investigation.
            </p>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">
                Dispute Details & Discrepancies *
              </label>
              <textarea
                required
                rows={3}
                value={disputeNotes}
                onChange={e => setDisputeNotes(e.target.value)}
                placeholder="State what is wrong (e.g. wrong model delivered, damaged goods, items missing from box)..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDisputeModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmDispute}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg transition-colors flex items-center gap-1.5"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>Submit Dispute</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
