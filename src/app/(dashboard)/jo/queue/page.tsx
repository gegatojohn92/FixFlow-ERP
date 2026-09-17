'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Wrench,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Flame,
  ArrowLeft,
  User,
  MapPin,
  AlertOctagon,
  Loader2,
  X,
  PlusCircle,
  PlayCircle,
  Package,
  Filter,
  Eye,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { acceptJobOrder, markJobOrderDone } from '@/lib/actions/jo-actions'
import type { JOStatus, JOPriority } from '@/types/index'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'
import { formatDateTime } from '@/lib/format-date'

interface TechnicianOption {
  id: string
  full_name: string
  role: string
}

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requester?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assignee?: any
}

const QUEUE_STATUSES: JOStatus[] = [
  'PENDING_ASSESSMENT',
  'IN_PROGRESS',
  'AWAITING_MRS_APPROVAL',
  'MRS_REJECTED',
  'REOPENED_UNRESOLVED',
 'MATERIALS_RECEIVED',

]

function ElapsedTimer({ startedAt }: { startedAt: string | null }) {
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    if (!startedAt) return
    const update = () => {
      const diff = Date.now() - new Date(startedAt).getTime()
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setElapsed(`${h > 0 ? `${h}h ` : ''}${m}m ${s}s`)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  if (!startedAt) return null
  return (
    <span className="font-mono text-[10px] text-amber-400 tabular-nums">
      ⏱ {elapsed}
    </span>
  )
}

export default function JOQueuePage() {
  const [jobOrders, setJobOrders] = useState<JobOrderRecord[]>([])
  const [selectedJO, setSelectedJO] = useState<JobOrderRecord | null>(null)
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([])
  const [attachments, setAttachments] = useState<{ id: number; file_url: string; context: string }[]>([])
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('ALL')

  // Accept Modal
  const [showAcceptModal, setShowAcceptModal] = useState(false)
  const [selectedTechnicianId, setSelectedTechnicianId] = useState('')

  // Mark Done Modal
  const [showMarkDoneModal, setShowMarkDoneModal] = useState(false)
  const [completionNotes, setCompletionNotes] = useState('')

  const supabase = createClient()

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
          .select('id, file_url, context')
          .eq('entity_type', 'job_order')
          .eq('entity_id', selectedJO.id)

        if (!isMounted) return
        setAttachments(data || [])
      })()
    }, 0)

    return () => {
      isMounted = false
      window.clearTimeout(timer)
    }
  }, [selectedJO, supabase])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error: fetchErr } = await supabase
        .from('job_orders')
        .select(`
          *,
          requester:users!job_orders_requester_id_fkey(full_name, role, department:departments(department_name)),
          assignee:users!job_orders_assignee_id_fkey(full_name, role)
        `)
        .in('status', QUEUE_STATUSES)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })

      if (fetchErr) throw fetchErr
      setJobOrders((data as JobOrderRecord[]) || [])

      const { data: techs } = await supabase
        .from('users')
        .select('id, full_name, role')
        .in('role', ['MAINTENANCE', 'MANAGER', 'SUPER_ADMIN'])
        .order('full_name')

      setTechnicians((techs as TechnicianOption[]) || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load queue.')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadData])

  const handleAccept = async () => {
    if (!selectedJO) return
    setActionLoading(true)
    setError(null)
    try {
      await acceptJobOrder(selectedJO.id, selectedTechnicianId || undefined)
      setShowAcceptModal(false)
      setSelectedTechnicianId('')
      setActionMessage(`✅ ${selectedJO.jo_number} accepted and assigned.`)
      await loadData()
      setSelectedJO(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to accept job order.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleMarkDone = async () => {
    if (!selectedJO) return
    setActionLoading(true)
    setError(null)
    try {
      await markJobOrderDone(selectedJO.id, completionNotes)
      setShowMarkDoneModal(false)
      setCompletionNotes('')
      setActionMessage(`✅ ${selectedJO.jo_number} marked as COMPLETED.`)
      await loadData()
      setSelectedJO(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to mark job order done.')
    } finally {
      setActionLoading(false)
    }
  }

  const getPriorityBadge = (priority: JOPriority) => {
    switch (priority) {
      case 'EMERGENCY': return 'bg-rose-950 text-rose-300 border-rose-800'
      case 'URGENT': return 'bg-amber-950 text-amber-300 border-amber-800'
      default: return 'bg-blue-950/60 text-blue-300 border-blue-900/60'
    }
  }

  const getStatusBadge = (status: JOStatus) => {
    switch (status) {
      case 'PENDING_ASSESSMENT': return 'bg-amber-950/80 text-amber-300 border-amber-800'
      case 'IN_PROGRESS': return 'bg-blue-950/80 text-blue-300 border-blue-800'
      case 'AWAITING_MRS_APPROVAL': return 'bg-purple-950/80 text-purple-300 border-purple-800'
      case 'MRS_REJECTED': return 'bg-rose-950/60 text-rose-300 border-rose-800/60'
      case 'REOPENED_UNRESOLVED': return 'bg-orange-950/80 text-orange-300 border-orange-800'
      case 'CRITICAL_REOPEN_ESCALATED': return 'bg-rose-950 text-rose-300 border-rose-800 animate-pulse'
      default: return 'bg-slate-800 text-slate-300 border-slate-700'
    }
  }

  const filtered = statusFilter === 'ALL'
    ? jobOrders
    : jobOrders.filter((jo) => jo.status === statusFilter)

  const formattedCode = (jo: JobOrderRecord) =>
    jo.revision_suffix > 0
      ? `${jo.jo_number}-${String(jo.revision_suffix).padStart(2, '0')}`
      : jo.jo_number

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
                Technician Queue
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-950 text-amber-400 border border-amber-900">
                FORM 3
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Accept, assign, and resolve active maintenance requests.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Filter:
          </span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Active</option>
            <option value="PENDING_ASSESSMENT">Pending Assessment</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="AWAITING_MRS_APPROVAL">Awaiting MRS</option>
            <option value="REOPENED_UNRESOLVED">Reopened</option>
          </select>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-center justify-between">
          <span>{actionMessage}</span>
          <button type="button" onClick={() => setActionMessage(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400 gap-2 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
          <span>Loading queue...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/60 border border-slate-800 rounded-2xl space-y-3">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <p className="text-sm text-slate-300 font-semibold">Queue is clear!</p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">No active job orders match the current filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Queue List */}
          <div className="space-y-2 lg:max-h-[720px] lg:overflow-y-auto pr-1">
            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="p-2.5 bg-amber-950/30 border border-amber-900/40 rounded-xl text-center">
                <div className="text-lg font-black text-amber-300">
                  {jobOrders.filter((j) => j.status === 'PENDING_ASSESSMENT').length}
                </div>
                <div className="text-[10px] text-amber-400/70 font-medium mt-0.5">Pending</div>
              </div>
              <div className="p-2.5 bg-blue-950/30 border border-blue-900/40 rounded-xl text-center">
                <div className="text-lg font-black text-blue-300">
                  {jobOrders.filter((j) => j.status === 'IN_PROGRESS').length}
                </div>
                <div className="text-[10px] text-blue-400/70 font-medium mt-0.5">Active</div>
              </div>
              <div className="p-2.5 bg-orange-950/30 border border-orange-900/40 rounded-xl text-center">
                <div className="text-lg font-black text-orange-300">
                  {jobOrders.filter((j) => j.status === 'REOPENED_UNRESOLVED').length}
                </div>
                <div className="text-[10px] text-orange-400/70 font-medium mt-0.5">Reopened</div>
              </div>
            </div>

            {filtered.map((jo) => (
              <button
                key={jo.id}
                type="button"
                onClick={() => setSelectedJO(jo)}
                className={`w-full text-left p-4 rounded-xl border transition-all space-y-2 ${
                  selectedJO?.id === jo.id
                    ? 'bg-slate-900 border-amber-500/80 shadow-lg shadow-amber-500/10'
                    : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-900/90'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-amber-400">{formattedCode(jo)}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getPriorityBadge(jo.priority)}`}>
                      {jo.priority}
                    </span>
                    {jo.reopen_count > 0 && <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />}
                  </div>
                </div>
                <p className="text-xs font-medium text-slate-200 line-clamp-1">{jo.title}</p>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    <span className="truncate max-w-[100px]">{jo.location}</span>
                  </span>
                  <span className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${getStatusBadge(jo.status)}`}>
                    {jo.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  By: <span className="text-slate-400">{jo.requester?.full_name ?? 'Staff'}</span>
                  {jo.requester?.department?.department_name && (
                    <span> · {jo.requester.department.department_name}</span>
                  )}
                </div>
                {jo.status === 'IN_PROGRESS' && <ElapsedTimer startedAt={jo.started_at} />}
              </button>
            ))}
          </div>

          {/* Detail Panel */}
          {selectedJO ? (
            <div className="lg:col-span-2 bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-800">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-lg font-black text-amber-400">{formattedCode(selectedJO)}</span>
                    {selectedJO.reopen_count > 0 && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black bg-orange-950 text-orange-300 border border-orange-800">
                        <AlertOctagon className="w-3 h-3" /> Reopen #{selectedJO.reopen_count}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${getPriorityBadge(selectedJO.priority)}`}>
                      {selectedJO.priority === 'EMERGENCY' && <Flame className="w-3 h-3 inline mr-1" />}
                      {selectedJO.priority === 'URGENT' && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                      {selectedJO.priority}
                    </span>
                  </div>
                  <h2 className="text-base font-bold text-white">{selectedJO.title}</h2>
                </div>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border self-start shrink-0 ${getStatusBadge(selectedJO.status)}`}>
                  {selectedJO.status.replace(/_/g, ' ')}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl text-xs">
                <div>
                  <span className="text-slate-400 text-[11px] block">Location:</span>
                  <span className="font-semibold text-slate-200 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 text-slate-400" />{selectedJO.location}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px] block">Requester:</span>
                  <span className="font-semibold text-slate-200 flex items-center gap-1 mt-0.5">
                    <User className="w-3 h-3 text-slate-400" />{selectedJO.requester?.full_name || 'Staff'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px] block">Department:</span>
                  <span className="font-semibold text-slate-200 mt-0.5 block">
                    {selectedJO.requester?.department?.department_name || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px] block">Assigned Tech:</span>
                  <span className="font-semibold text-slate-200 flex items-center gap-1 mt-0.5">
                    <Wrench className="w-3 h-3 text-slate-400" />
                    {selectedJO.assignee?.full_name || <span className="text-slate-500 italic">Unassigned</span>}
                  </span>
                </div>
              </div>

              {selectedJO.status === 'IN_PROGRESS' && selectedJO.started_at && (
                <div className="flex items-center gap-2 p-3 bg-blue-950/30 border border-blue-900/50 rounded-xl text-xs text-blue-300">
                  <Clock className="w-4 h-4 text-blue-400 shrink-0" />
                  <div>
                    <span className="font-semibold block text-blue-200">Job Timer Running</span>
                    <ElapsedTimer startedAt={selectedJO.started_at} />
                    <span className="text-[10px] text-blue-400/70"> since {formatDateTime(selectedJO.started_at)}</span>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">Problem Description</span>
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {selectedJO.description}
                </div>
              </div>

              {/* Site & Attached Photos Gallery */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                  Site & Attached Photos ({attachments.length})
                </span>

                {attachments.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="group relative aspect-square rounded-xl overflow-hidden border border-slate-700 bg-slate-950 shadow-sm"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={att.file_url}
                          alt="Job site"
                          className="w-full h-full object-cover transition-transform group-hover:scale-105 cursor-pointer"
                          onClick={() => setLightboxImage(att.file_url)}
                        />
                        <button
                          type="button"
                          onClick={() => setLightboxImage(att.file_url)}
                          className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                          title="View photo full size"
                        >
                          <Eye className="w-5 h-5" />
                        </button>
                        <span className="absolute bottom-1 left-1 right-1 text-[9px] bg-black/75 text-slate-300 px-1 py-0.5 rounded truncate font-mono">
                          {att.context === 'JO_REOPEN_PHOTO' ? 'Reopen Photo' : 'Site Photo'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">No site photos attached to this ticket.</p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-400 font-mono">
                <div>
                  <span className="block text-[10px] text-slate-500">SUBMITTED:</span>
                  <span>{formatDateTime(selectedJO.created_at)}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-500">STARTED:</span>
                  <span>{formatDateTime(selectedJO.started_at)}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-500">COMPLETED:</span>
                  <span>{formatDateTime(selectedJO.completed_at)}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-end gap-3">
                {selectedJO.status === 'PENDING_ASSESSMENT' && (
                  <button
                    type="button"
                    onClick={() => { setSelectedTechnicianId(''); setShowAcceptModal(true) }}
                    className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors shadow-lg shadow-blue-600/20"
                  >
                    <PlayCircle className="w-4 h-4" /> Accept Request
                  </button>
                )}
                {selectedJO.status === 'IN_PROGRESS' && (
                  <Link
                    href={`/mrs/new?jo_id=${selectedJO.id}`}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition-colors shadow-lg shadow-purple-600/20"
                  >
                    <Package className="w-4 h-4" /> Request MRS
                  </Link>
                )}
                {(selectedJO.status === 'IN_PROGRESS' || selectedJO.status === 'REOPENED_UNRESOLVED') && (
                  <button
                    type="button"
                    onClick={() => { setCompletionNotes(''); setShowMarkDoneModal(true) }}
                    className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors shadow-lg shadow-emerald-600/20"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Mark Done
                  </button>
                )}
                {selectedJO.reopen_count >= 2 && (
                  <Link
                    href="/jo/queue/escalated"
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-800 rounded-xl text-xs font-bold transition-colors"
                  >
                    <AlertOctagon className="w-4 h-4" /> Escalated Queue
                  </Link>
                )}
                <Link
                  href="/jo/new"
                  className="flex items-center gap-1.5 px-3.5 py-2.5 border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition-colors"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> New JO
                </Link>
              </div>
            </div>
          ) : (
            <div className="lg:col-span-2 flex items-center justify-center bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center">
              <div className="space-y-2">
                <Clock className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-sm text-slate-400">Select a job order from the queue to see details and actions.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Accept / Assign Modal */}
      {showAcceptModal && selectedJO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-slate-100">
            <div className="flex items-center gap-2">
              <PlayCircle className="w-5 h-5 text-blue-400" />
              <h3 className="text-sm font-bold text-white">Accept & Assign Job Order</h3>
            </div>
            <p className="text-xs text-slate-300">
              Job: <b className="font-mono text-amber-400">{formattedCode(selectedJO)}</b> — {selectedJO.title}
            </p>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Assign Technician (leave blank to self-assign):
              </label>
              <select
                value={selectedTechnicianId}
                onChange={(e) => setSelectedTechnicianId(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Self-assign —</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>{t.full_name} ({t.role})</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAcceptModal(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleAccept}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Accept & Start
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mark Done Modal */}
      {showMarkDoneModal && selectedJO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-slate-100">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Mark Job Order Complete</h3>
            </div>
            <p className="text-xs text-slate-300">
              This sets <b className="font-mono text-amber-400">{formattedCode(selectedJO)}</b> to{' '}
              <b className="text-emerald-300">COMPLETED</b> and notifies the requester.
            </p>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">Completion Notes (optional):</label>
              <textarea
                rows={3}
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                placeholder="Describe what was done, parts replaced, or steps taken..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowMarkDoneModal(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleMarkDone}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Mark as Completed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Lightbox Modal */}
      <PhotoLightbox
        isOpen={Boolean(lightboxImage)}
        onClose={() => setLightboxImage(null)}
        imageUrl={lightboxImage}
        title={selectedJO ? `${formattedCode(selectedJO)} Site Photo` : 'Site Photo'}
      />
    </div>
  )
}
