'use client'

import React, { useState, useEffect } from 'react'
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Building,
  Globe,
  FileText,
  ExternalLink,
  Eye,
  ImageIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { managerReviewMRS } from '@/lib/actions/mrs-actions'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'
import { useActionLock } from '@/components/ui/ActionLock'
import { formatDate } from '@/lib/format-date'

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

type MRSManagerRow = Omit<MRSManagerItem, 'attachments'> & {
  attachments?: { id: number; file_url: string; context: string }[]
}

interface MRSManagerItem {
  id: number
  mrs_number: string
  purpose: string
  created_at: string | null
  total_estimated_cost: number
  is_online_purchase: boolean
  online_supplier_url: string | null
  attachments: { id: number; file_url: string; context: string }[]
  est_shipping_fee: number
  department: { department_name: string } | null
  requester: { full_name: string } | null
  job_order: { jo_number: string; title: string; priority: string } | null
  mrs_line_items: LineItem[]
}

export default function ManagerMRSQueuePage() {
  const { runLocked } = useActionLock()
  const [queue, setQueue] = useState<MRSManagerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMRS, setSelectedMRS] = useState<MRSManagerItem | null>(null)
  const [reviewModalMode, setReviewModalMode] = useState<'APPROVE' | 'DECLINE' | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [activePhoto, setActivePhoto] = useState<{ url: string; title: string } | null>(null)

  const supabase = createClient()

  const fetchQueue = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: qErr } = await supabase
        .from('material_requisitions')
        .select(`
          id, mrs_number, purpose, created_at, total_estimated_cost, is_online_purchase,
          online_supplier_url, est_shipping_fee,
          department:departments(department_name),
          requester:users!material_requisitions_requester_id_fkey(full_name),
          job_order:job_orders!material_requisitions_jo_id_fkey(jo_number, title, priority),
          mrs_line_items(id, item_description, qty_requested, qty_issued_from_stock, unit, est_unit_price, store_name, reference_photo_url)
        `)
        .eq('overall_status', 'PENDING_MANAGER')
        .order('created_at', { ascending: true })

      if (qErr) throw qErr

      const mrsIds = (data || []).map((r: { id: number }) => r.id)
      let screenshotsMap: Record<number, string> = {}
      if (mrsIds.length > 0) {
        const { data: attData } = await supabase
          .from('attachments')
          .select('entity_id, file_url')
          .eq('context', 'MRS_ONLINE_SCREENSHOT')
          .in('entity_id', mrsIds)
        if (attData) {
          screenshotsMap = Object.fromEntries(
            attData.map((attachment: { entity_id: number; file_url: string }) => [attachment.entity_id, attachment.file_url])
          )
        }
      }

      const merged = (data || []).map((row: MRSManagerRow) => ({
        ...row,
        attachments: screenshotsMap[row.id]
          ? [{ id: row.id, file_url: screenshotsMap[row.id], context: 'MRS_ONLINE_SCREENSHOT' }]
          : [],
      }))
      setQueue(merged)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load manager queue.')
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

  const handleOpenReview = (mrs: MRSManagerItem, mode: 'APPROVE' | 'DECLINE') => {
    setSelectedMRS(mrs)
    setReviewModalMode(mode)
    setRejectionReason('')
  }

  const handleConfirmReview = async () => {

    await runLocked('Recording manager decision…', async () => {
      if (!selectedMRS || !reviewModalMode) return
      if (reviewModalMode === 'DECLINE' && !rejectionReason.trim()) {
        setError('Please provide a mandatory reason for rejecting this requisition.')
        return
      }

      setSubmitting(true)
      setError(null)
      setActionSuccess(null)

      try {
        const res = await managerReviewMRS({
          mrsId: selectedMRS.id,
          approved: reviewModalMode === 'APPROVE',
          rejectionReason: reviewModalMode === 'DECLINE' ? rejectionReason.trim() : undefined,
        })

        if (res.success) {
          setActionSuccess(
            reviewModalMode === 'APPROVE'
              ? `Requisition ${selectedMRS.mrs_number} approved and forwarded to Budget Officer for canvassing.`
              : `Requisition ${selectedMRS.mrs_number} rejected. Reason logged in audit records.`
          )
          setSelectedMRS(null)
          setReviewModalMode(null)
          fetchQueue()
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to execute review.')
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
            <ClipboardCheck className="w-6 h-6 text-blue-500" />
            <h1 className="text-xl font-black text-white tracking-tight">
              Manager Requisition Approvals
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Form 7 — Review unfulfilled material requisitions before supplier canvassing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-blue-950/60 border border-blue-800/80 rounded-lg text-xs font-bold text-blue-300">
            {queue.length} Pending Approval
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

      {/* Queue */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mr-3" />
          <span>Loading manager queue...</span>
        </div>
      ) : queue.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-500 mx-auto">
            <ClipboardCheck className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-white">All Clear</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            No requisitions currently awaiting manager approval.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map(mrs => {
            const hasStockIssued = mrs.mrs_line_items.some(i => i.qty_issued_from_stock > 0)
            return (
              <div
                key={mrs.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 hover:border-slate-700 transition-colors"
              >
                {/* Header info */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-black text-white">
                        {mrs.mrs_number}
                      </span>
                      {hasStockIssued && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                          Partially Warehouse Stocked
                        </span>
                      )}
                      {mrs.is_online_purchase && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800 flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          <span>Online Purchase</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <Building className="w-3.5 h-3.5" />
                      <span>{mrs.department?.department_name ?? 'General'}</span>
                      <span>•</span>
                      <span>By: {mrs.requester?.full_name ?? 'Staff'}</span>
                      <span>•</span>
                      <span>{formatDate(mrs.created_at)}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block uppercase tracking-wider">
                      Est. Total
                    </span>
                    <span className="text-lg font-black text-white font-mono">
                      ₱{Number(mrs.total_estimated_cost).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {/* Linked JO Banner */}
                {mrs.job_order && (
                  <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-400" />
                      <span className="text-slate-400">Linked JO:</span>
                      <span className="font-mono font-bold text-white">{mrs.job_order.jo_number}</span>
                      <span className="text-slate-300 truncate max-w-xs sm:max-w-md">
                        {mrs.job_order.title}
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      mrs.job_order.priority === 'EMERGENCY'
                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                        : 'bg-slate-800 text-slate-300'
                    }`}>
                      {mrs.job_order.priority}
                    </span>
                  </div>
                )}

                {/* Purpose */}
                <p className="text-xs text-slate-200">
                  <strong className="text-slate-400">Purpose: </strong>
                  {mrs.purpose}
                </p>

                {/* Online panel if applicable */}
                {mrs.is_online_purchase && (mrs.online_supplier_url || mrs.attachments?.some(a => a.context === 'MRS_ONLINE_SCREENSHOT')) && (
                  <div className="p-2.5 bg-indigo-950/30 border border-indigo-900/60 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-indigo-300 truncate max-w-sm">
                      {mrs.online_supplier_url ? `URL: ${mrs.online_supplier_url}` : 'Online Purchase Item'}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {(() => {
                        const screenshot = mrs.attachments?.find(a => a.context === 'MRS_ONLINE_SCREENSHOT')
                        return screenshot ? (
                          <button
                            type="button"
                            onClick={() =>
                              setActivePhoto({
                                url: screenshot.file_url,
                                title: `${mrs.mrs_number} — Online Cart Screenshot`,
                              })
                            }
                            className="px-2.5 py-1 bg-indigo-900/70 hover:bg-indigo-800 text-indigo-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border border-indigo-700/60"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Cart Screenshot</span>
                          </button>
                        ) : null
                      })()}
                      {mrs.online_supplier_url && (
                        <a
                          href={mrs.online_supplier_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-bold"
                        >
                          <span>Open Link</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Line Items Table */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                    Line Items ({mrs.mrs_line_items.length}):
                  </span>
                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    {mrs.mrs_line_items.map(item => {
                      const remainingToBuy = Math.max(0, item.qty_requested - item.qty_issued_from_stock)
                      return (
                        <div
                          key={item.id}
                          className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="flex items-start gap-3">
                            {item.reference_photo_url ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setActivePhoto({
                                    url: item.reference_photo_url!,
                                    title: item.item_description,
                                  })
                                }
                                className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-700 bg-slate-900 shrink-0 group focus:outline-none"
                                title="Click to enlarge photo"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={item.reference_photo_url}
                                  alt={item.item_description}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                  <Eye className="w-3.5 h-3.5 text-white" />
                                </div>
                              </button>
                            ) : (
                              <div className="w-12 h-12 rounded-lg border border-slate-800 bg-slate-900/50 flex items-center justify-center text-slate-600 shrink-0">
                                <ImageIcon className="w-4 h-4" />
                              </div>
                            )}

                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-200 block">
                                  {item.item_description}
                                </span>
                                {item.reference_photo_url && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setActivePhoto({
                                        url: item.reference_photo_url!,
                                        title: item.item_description,
                                      })
                                    }
                                    className="px-1.5 py-0.5 bg-blue-950 text-blue-300 border border-blue-800 rounded text-[10px] font-medium flex items-center gap-1 hover:bg-blue-900"
                                  >
                                    <Eye className="w-2.5 h-2.5" /> Photo
                                  </button>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                                <span>Req: {item.qty_requested} {item.unit}</span>
                                {item.qty_issued_from_stock > 0 && (
                                  <span className="text-amber-400">
                                    (Stock issued: {item.qty_issued_from_stock})
                                  </span>
                                )}
                                {item.store_name && (
                                  <span>Store: {item.store_name}</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-4">
                            <span className="font-mono text-slate-300">
                              To Buy: <strong>{remainingToBuy} {item.unit}</strong> × ₱{Number(item.est_unit_price).toFixed(2)}
                            </span>
                            <span className="font-mono font-bold text-white">
                              ₱{(remainingToBuy * Number(item.est_unit_price)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => handleOpenReview(mrs, 'DECLINE')}
                    className="px-4 py-2 bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Decline MRS</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenReview(mrs, 'APPROVE')}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-blue-500/20 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Approve MRS</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Confirmation Modal */}
      {selectedMRS && reviewModalMode && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-white">
              {reviewModalMode === 'APPROVE'
                ? `Approve Requisition ${selectedMRS.mrs_number}?`
                : `Decline Requisition ${selectedMRS.mrs_number}`}
            </h3>

            {reviewModalMode === 'APPROVE' ? (
              <p className="text-xs text-slate-300">
                Approving will advance this requisition to <strong>In Canvassing</strong>. The Budget Officer will review pricing and prepare the Owner approval snapshot.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-slate-300">
                  Declining will set the requisition to <strong>MANAGER_REJECTED</strong> and notify the requester.
                </p>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">
                    Mandatory Rejection Rationale *
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    placeholder="Provide specific reason (e.g. out of scope, alternate solution in place, budget freeze)..."
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedMRS(null)
                  setReviewModalMode(null)
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmReview}
                className={`px-5 py-2 text-white text-xs font-bold rounded-xl shadow-lg flex items-center gap-1.5 transition-colors ${
                  reviewModalMode === 'APPROVE'
                    ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/20'
                    : 'bg-rose-600 hover:bg-rose-500 shadow-rose-500/20'
                }`}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>{reviewModalMode === 'APPROVE' ? 'Confirm Approval' : 'Confirm Rejection'}</span>
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
