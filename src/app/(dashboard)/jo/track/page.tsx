'use client'

import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Wrench,
  AlertTriangle,
  Flame,
  ArrowLeft,
  XCircle,
  RotateCcw,
  User,
  MapPin,
  AlertOctagon,
  Loader2,
  X,
  PlusCircle,
  Archive,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cancelJobOrder, reopenJobOrder, closeJobOrder } from '@/lib/actions/jo-actions'
import { CameraCapture, type AttachmentRecord } from '@/components/hardware/CameraCapture'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'
import { CLOSEABLE_JO_STATUSES, JO_CLOSE_ROLES } from '@/lib/status-machines'
import type { JOStatus, JOPriority, UserRole } from '@/types/index'
import { useActionLock } from '@/components/ui/ActionLock'
import { formatDate, formatDateTime } from '@/lib/format-date'

interface JobOrderRecord {
  id: number
  jo_number: string
  revision_suffix: number
  title: string
  description: string
  location: string
  priority: JOPriority
  status: JOStatus
  reopen_count: number
  started_at: string | null
  completed_at: string | null
  created_at: string
  requester_id: string
  assignee_id: string | null
  cancellation_reason: string | null
  cancelled_at: string | null
  closed_at: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requester?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assignee?: any
}

export default function TrackJobOrdersPage() {
  const { runLocked } = useActionLock()
  const searchParams = useSearchParams()
  const initialId = searchParams.get('id')

  const [jobOrders, setJobOrders] = useState<JobOrderRecord[]>([])
  const [selectedJO, setSelectedJO] = useState<JobOrderRecord | null>(null)
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<UserRole | ''>('')

  // Modals state
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [showReopenModal, setShowReopenModal] = useState(false)
  const [reopenNotes, setReopenNotes] = useState('')
  const [reopenAttachments, setReopenAttachments] = useState<AttachmentRecord[]>([])
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [closeNotes, setCloseNotes] = useState('')
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  const supabase = createClient()

  // Fetch all user's Job Orders
  useEffect(() => {
    async function loadJOs() {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // Role is needed to render the managerial "Close Job Order" action
        const { data: profile } = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .single()
        if (profile?.role) setUserRole(profile.role as UserRole)

        const { data, error: fetchErr } = await supabase
          .from('job_orders')
          .select(`
            *,
            requester:users!job_orders_requester_id_fkey(full_name, role),
            assignee:users!job_orders_assignee_id_fkey(full_name, role)
          `)
          .order('created_at', { ascending: false })

        if (fetchErr) throw fetchErr

        const list = (data as JobOrderRecord[]) || []
        setJobOrders(list)

        if (initialId) {
          const found = list.find((j: JobOrderRecord) => j.id.toString() === initialId)
          if (found) setSelectedJO(found)
          else if (list.length > 0) setSelectedJO(list[0])
        } else if (list.length > 0) {
          setSelectedJO(list[0])
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load tickets.')
      } finally {
        setLoading(false)
      }
    }
    const timer = window.setTimeout(() => {
      void loadJOs()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [initialId, supabase])

  // Load attachments when selectedJO changes
  useEffect(() => {
    if (!selectedJO) {
      return
    }

    let isMounted = true

    const timer = window.setTimeout(() => {
      void (async () => {
        const { data } = await supabase
          .from('attachments')
          .select('*')
          .eq('entity_type', 'job_order')
          .eq('entity_id', selectedJO.id)

        if (!isMounted) return
        if (data) {
          setAttachments(data as AttachmentRecord[])
        }
      })()
    }, 0)

    return () => {
      isMounted = false
      window.clearTimeout(timer)
    }
  }, [selectedJO, supabase])

  // Cancel Handler (Plan.md §0.7)
  const handleConfirmCancel = async () => {
    await runLocked('Cancelling job order…', async () => {
      if (!selectedJO) return
      setActionLoading(true)
      setError(null)
      try {
        const result = await cancelJobOrder(selectedJO.id, cancelReason)
        if (!result.success) {
          setError(result.error)
          return
        }
        setShowCancelModal(false)
        setCancelReason('')
        setActionMessage('Job order cancelled. Cascade cancellation locks updated.')
        // Refresh local record
        setSelectedJO({ ...selectedJO, status: 'CANCELLED' })
        setJobOrders((prev) =>
          prev.map((j) => (j.id === selectedJO.id ? { ...j, status: 'CANCELLED' } : j))
        )
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to cancel job order.')
      } finally {
        setActionLoading(false)
      }
    })
  }

  // Issue Still Persists (Reopen) Handler (Plan.md §0.10 & §5 Form 2)
  const handleConfirmReopen = async () => {
    await runLocked('Reopening job order…', async () => {
      if (!selectedJO || !reopenNotes.trim()) return
      setActionLoading(true)
      setError(null)
      try {
        const photoUrl = reopenAttachments.length > 0 ? reopenAttachments[0].file_url : undefined
        const res = await reopenJobOrder({
          joId: selectedJO.id,
          notes: reopenNotes,
          photoUrl,
        })
        if (!res.success) {
          setError(res.error)
          return
        }

        setShowReopenModal(false)
        setReopenNotes('')
        setReopenAttachments([])
        setActionMessage(
          res.status === 'CRITICAL_REOPEN_ESCALATED'
            ? '⚠️ Escalated to Manager! Reopened ≥ 2 times.'
            : 'Job order reopened. Re-routed to maintenance queue.'
        )

        const updatedSuffix = (selectedJO.revision_suffix ?? 0) + 1
        const updatedJO: JobOrderRecord = {
          ...selectedJO,
          status: res.status as JOStatus,
          revision_suffix: updatedSuffix,
          reopen_count: res.reopenCount,
          assignee_id: null,
        }
        setSelectedJO(updatedJO)
        setJobOrders((prev) =>
          prev.map((j) => (j.id === selectedJO.id ? updatedJO : j))
        )
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to reopen job order.')
      } finally {
        setActionLoading(false)
      }
    })
  }

  // Close Job Order Handler (0011 — final acceptance by management)
  const handleConfirmClose = async () => {
    await runLocked('Closing job order…', async () => {
      if (!selectedJO) return
      setActionLoading(true)
      setError(null)
      try {
        const result = await closeJobOrder(selectedJO.id, closeNotes)
        if (!result.success) {
          setError(result.error)
          return
        }
        setShowCloseModal(false)
        setCloseNotes('')
        setActionMessage(`Job order ${selectedJO.jo_number} final-accepted and closed.`)
        setSelectedJO({ ...selectedJO, status: 'CLOSED' })
        setJobOrders((prev) =>
          prev.map((j) => (j.id === selectedJO.id ? { ...j, status: 'CLOSED' } : j))
        )
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to close job order.')
      } finally {
        setActionLoading(false)
      }
    })
  }

  const getStatusBadge = (status: JOStatus) => {
    switch (status) {
      case 'PENDING_ASSESSMENT':
        return 'bg-amber-950/80 text-amber-300 border-amber-800'
      case 'IN_PROGRESS':
        return 'bg-blue-950/80 text-blue-300 border-blue-800'
      case 'AWAITING_MRS_APPROVAL':
        return 'bg-purple-950/80 text-purple-300 border-purple-800'
      case 'MRS_REJECTED':
        return 'bg-rose-950/60 text-rose-300 border-rose-800/60'
      case 'MATERIALS_RECEIVED':
        return 'bg-teal-950/80 text-teal-300 border-teal-800'
      case 'COMPLETED':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
      case 'CLOSED':
        return 'bg-slate-800 text-slate-300 border-slate-700'
      case 'CRITICAL_REOPEN_ESCALATED':
        return 'bg-rose-950 text-rose-300 border-rose-800 animate-pulse font-bold'
      case 'REOPENED_UNRESOLVED':
        return 'bg-orange-950/80 text-orange-300 border-orange-800'
      case 'CANCELLED':
        return 'bg-slate-800 text-slate-400 border-slate-700'
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700'
    }
  }

  // Can cancel if in PENDING_ASSESSMENT, IN_PROGRESS, or AWAITING_MRS_APPROVAL (§0.7)
  const canCancel =
    selectedJO &&
    ['PENDING_ASSESSMENT', 'IN_PROGRESS', 'AWAITING_MRS_APPROVAL'].includes(
      selectedJO.status
    )

  // Can reopen only if COMPLETED (§0.10 & §5 Form 2)
  const canReopen = selectedJO && selectedJO.status === 'COMPLETED'

  // Can final-close (COMPLETED / MATERIALS_RECEIVED → CLOSED) if a managerial role (0011)
  const canClose =
    selectedJO &&
    userRole !== '' &&
    (JO_CLOSE_ROLES as readonly string[]).includes(userRole) &&
    (CLOSEABLE_JO_STATUSES as readonly string[]).includes(selectedJO.status)

  // Materials may be requested while IN_PROGRESS, or re-requested after a
  // MRS rejection (the JO guard allows MRS_REJECTED → AWAITING_MRS_APPROVAL)
  const canRequestMaterials =
    selectedJO && ['IN_PROGRESS', 'MRS_REJECTED'].includes(selectedJO.status)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                Track Job Orders
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-950 text-blue-400 border border-blue-900">
                FORM 2
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Monitor status, view photos, cancel pending requests, or flag persisting issues.
            </p>
          </div>
        </div>

        <Link
          href="/jo/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors w-fit"
        >
          <PlusCircle className="w-4 h-4" />
          <span>New Job Order</span>
        </Link>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-center justify-between">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400 gap-2 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
          <span>Loading Job Orders...</span>
        </div>
      ) : jobOrders.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/60 border border-slate-800 rounded-2xl space-y-3">
          <Wrench className="w-10 h-10 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-300 font-semibold">No Job Orders Found</p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            You have not submitted any maintenance requests yet.
          </p>
          <Link
            href="/jo/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-500"
          >
            Create Your First Job Order
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Tickets Selector List */}
          <div className="space-y-2 lg:max-h-[720px] lg:overflow-y-auto pr-1">
            {jobOrders.map((jo) => {
              const formattedCode =
                jo.revision_suffix && jo.revision_suffix > 0
                  ? `${jo.jo_number}-${String(jo.revision_suffix).padStart(2, '0')}`
                  : jo.jo_number

              const isSelected = selectedJO?.id === jo.id

              return (
                <button
                  key={jo.id}
                  type="button"
                  onClick={() => setSelectedJO(jo)}
                  className={`w-full text-left p-4 rounded-xl border transition-all space-y-2 ${
                    isSelected
                      ? 'bg-slate-900 border-blue-500/80 shadow-lg shadow-blue-500/10'
                      : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-900/90'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-blue-400">
                      {formattedCode}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[9px] font-mono border font-semibold ${getStatusBadge(
                        jo.status
                      )}`}
                    >
                      {jo.status}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-slate-200 line-clamp-1">
                    {jo.title}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="truncate max-w-[120px]">{jo.location}</span>
                    <span>{formatDate(jo.created_at)}</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right Column: Selected Ticket Full Details & Action Controls */}
          {selectedJO && (
            <div className="lg:col-span-2 space-y-6 bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
              {/* Ticket Code & Status Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <Link href={`/audit-logs/job_order/${selectedJO.id}`} className="font-mono text-lg font-black text-blue-400 hover:text-cyan-300" title="View audit history">
                      {selectedJO.revision_suffix > 0
                        ? `${selectedJO.jo_number}-${String(
                            selectedJO.revision_suffix
                          ).padStart(2, '0')}`
                        : selectedJO.jo_number}
                    </Link>
                    {selectedJO.reopen_count >= 2 && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black bg-rose-950 text-rose-300 border border-rose-800 animate-pulse">
                        <AlertOctagon className="w-3 h-3" />
                        CRITICAL ESCALATION
                      </span>
                    )}
                  </div>
                  <h2 className="text-base font-bold text-white mt-1">
                    {selectedJO.title}
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border ${getStatusBadge(
                      selectedJO.status
                    )}`}
                  >
                    {selectedJO.status}
                  </span>
                </div>
              </div>

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl text-xs">
                <div>
                  <span className="text-slate-400 text-[11px] block">Location:</span>
                  <span className="font-semibold text-slate-200 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    {selectedJO.location}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 text-[11px] block">Priority:</span>
                  <span className="font-bold flex items-center gap-1 mt-0.5">
                    {selectedJO.priority === 'EMERGENCY' ? (
                      <span className="text-rose-400 flex items-center gap-1 font-bold">
                        <Flame className="w-3 h-3" /> EMERGENCY
                      </span>
                    ) : selectedJO.priority === 'URGENT' ? (
                      <span className="text-amber-400 flex items-center gap-1 font-bold">
                        <AlertTriangle className="w-3 h-3" /> URGENT
                      </span>
                    ) : (
                      <span className="text-blue-400">NORMAL</span>
                    )}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 text-[11px] block">Requester:</span>
                  <span className="font-semibold text-slate-200 flex items-center gap-1 mt-0.5">
                    <User className="w-3 h-3 text-slate-400" />
                    {selectedJO.requester?.full_name || 'Staff'}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 text-[11px] block">Assigned Tech:</span>
                  <span className="font-semibold text-slate-200 flex items-center gap-1 mt-0.5">
                    <Wrench className="w-3 h-3 text-slate-400" />
                    {selectedJO.assignee?.full_name || (
                      <span className="text-slate-500 italic">Unassigned</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Problem Description */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                  Reported Problem Description
                </span>
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {selectedJO.description}
                </div>
              </div>

              {/* Photos Lightbox Gallery (Plan.md §5 Form 2) */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                  Site & Attached Photos ({attachments.length})
                </span>

                {attachments.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {attachments.map((att) => (
                      <button
                        key={att.id}
                        type="button"
                        onClick={() => setLightboxImage(att.file_url)}
                        className="group relative aspect-square rounded-xl overflow-hidden border border-slate-700 bg-slate-950 focus:outline-none"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={att.file_url}
                          alt="Job site"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <span className="absolute bottom-1 left-1 right-1 text-[9px] bg-black/70 text-slate-300 px-1 rounded truncate">
                          {att.context === 'JO_REOPEN_PHOTO' ? 'Reopen Photo' : 'Site Photo'}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">
                    No site photos attached to this ticket.
                  </p>
                )}
              </div>

              {/* Timestamps audit trail */}
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-800 text-[11px] text-slate-400 font-mono">
                <div>
                  <span className="block text-[10px] text-slate-500">SUBMITTED:</span>
                  <span>{formatDateTime(selectedJO.created_at)}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-500">STARTED:</span>
                  <span>
                    {selectedJO.started_at
                      ? formatDateTime(selectedJO.started_at)
                      : '—'}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-500">COMPLETED:</span>
                  <span>
                    {selectedJO.completed_at
                      ? formatDateTime(selectedJO.completed_at)
                      : '—'}
                  </span>
                </div>
              </div>

              {/* Cancellation Audit (0011 — reason, timestamp, actor) */}
              {selectedJO.status === 'CANCELLED' && (
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400 space-y-1">
                  <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Cancellation Record</span>
                  {selectedJO.cancelled_at && <div>CANCELLED: {formatDateTime(selectedJO.cancelled_at)}</div>}
                  {selectedJO.cancellation_reason && <div>REASON: {selectedJO.cancellation_reason}</div>}
                  {!selectedJO.cancellation_reason && !selectedJO.cancelled_at && (
                    <div>Cancelled (no reason recorded).</div>
                  )}
                </div>
              )}

              {/* Closure Audit (0011) */}
              {selectedJO.status === 'CLOSED' && selectedJO.closed_at && (
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400">
                  <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Closure Record</span>
                  <div className="mt-1">FINAL-ACCEPTED: {formatDateTime(selectedJO.closed_at)}</div>
                </div>
              )}

              {/* Action Buttons: [Cancel Request], [Issue Still Persists], [Close], [Request MRS] */}
              <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-end gap-3">
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => setShowCancelModal(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/80 rounded-xl text-xs font-semibold transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Cancel Request</span>
                  </button>
                )}

                {canReopen && (
                  <button
                    type="button"
                    onClick={() => setShowReopenModal(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition-colors shadow-lg shadow-amber-600/20"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Issue Still Persists (Reopen)</span>
                  </button>
                )}

                {canClose && (
                  <button
                    type="button"
                    onClick={() => { setCloseNotes(''); setShowCloseModal(true) }}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-800/80 rounded-xl text-xs font-semibold transition-colors"
                  >
                    <Archive className="w-4 h-4" />
                    <span>Close Job Order (Final Acceptance)</span>
                  </button>
                )}

                {canRequestMaterials && (
                  <Link
                    href={`/mrs/new?jo_id=${selectedJO.id}`}
                    className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition-colors shadow-lg shadow-purple-600/20"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>Request Materials (MRS)</span>
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cancel Confirmation Modal (Plan.md §0.7) */}
      {showCancelModal && selectedJO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-slate-100">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold text-white">Cancel Job Order?</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Canceling <b className="font-mono text-blue-400">{selectedJO.jo_number}</b> will trigger
              the <b>Cascade Cancellation Lock (§3.5)</b>: linked unpurchased requisitions will be voided
              and pending transmittals cancelled.
            </p>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Cancellation Reason:
              </label>
              <textarea
                rows={2}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Issue resolved independently / duplicate ticket..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
              >
                Go Back
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleConfirmCancel}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Cancellation</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Issue Still Persists (Reopen) Modal (Plan.md §0.10 & §5 Form 2) */}
      {showReopenModal && selectedJO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-slate-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400">
                <RotateCcw className="w-5 h-5 shrink-0" />
                <h3 className="text-sm font-bold text-white">Reopen Job Order</h3>
              </div>
              <button onClick={() => setShowReopenModal(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              This will increment the revision suffix on the <b>same row</b> (to revision -
              {String((selectedJO.revision_suffix ?? 0) + 1).padStart(2, '0')}).
              {selectedJO.reopen_count >= 1 && (
                <span className="block text-rose-400 font-semibold mt-1">
                  ⚠️ Notice: This is reopen #{selectedJO.reopen_count + 1} and will trigger a{' '}
                  <b>CRITICAL ESCALATION</b> to the Manager!
                </span>
              )}
            </p>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Persistent Symptoms / Problem Notes <span className="text-rose-400">*</span>:
              </label>
              <textarea
                required
                rows={3}
                value={reopenNotes}
                onChange={(e) => setReopenNotes(e.target.value)}
                placeholder="Explain what is still not working or why the repair failed..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <CameraCapture
              context="JO_REOPEN_PHOTO"
              entityType="job_order"
              maxFiles={1}
              label="New Proof Photo (Optional)"
              existingAttachments={reopenAttachments}
              onAttachmentsChange={setReopenAttachments}
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowReopenModal(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || !reopenNotes.trim()}
                onClick={handleConfirmReopen}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Submit Reopen Request</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Job Order Modal (0011 — managerial final acceptance) */}
      {showCloseModal && selectedJO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-slate-100">
            <div className="flex items-center gap-2 text-emerald-400">
              <Archive className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold text-white">Close Job Order?</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Closing <b className="font-mono text-blue-400">{selectedJO.jo_number}</b> records{' '}
              <b>final management acceptance</b>. The ticket becomes <b>CLOSED</b> (terminal) and
              can no longer be reopened or have materials requested against it.
            </p>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Closure Notes (optional):
              </label>
              <textarea
                rows={2}
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                placeholder="e.g. Verified by walk-through; asset returned to service..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
              >
                Go Back
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleConfirmClose}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Close</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      <PhotoLightbox
        isOpen={Boolean(lightboxImage)}
        onClose={() => setLightboxImage(null)}
        imageUrl={lightboxImage}
        title={selectedJO ? `${selectedJO.jo_number} — ${selectedJO.title}` : 'Job Order Photo'}
        context="JO_SITE_PHOTO"
      />
    </div>
  )
}
