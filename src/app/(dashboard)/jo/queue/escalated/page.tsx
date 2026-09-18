'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  AlertOctagon,
  ArrowLeft,
  User,
  MapPin,
  Loader2,
  X,
  Wrench,
  RotateCcw,
  Clock,
  Flame,
  AlertTriangle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { reassignEscalatedJobOrder, markJobOrderDone } from '@/lib/actions/jo-actions'
import { useActionLock } from '@/components/ui/ActionLock'
import type { JOStatus, JOPriority } from '@/types/index'

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

const ESCALATED_STATUSES: JOStatus[] = ['REOPENED_UNRESOLVED', 'CRITICAL_REOPEN_ESCALATED']

export default function EscalatedQueuePage() {
  const { runLocked } = useActionLock()
  const [jobOrders, setJobOrders] = useState<JobOrderRecord[]>([])
  const [selectedJO, setSelectedJO] = useState<JobOrderRecord | null>(null)
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([])
  const [siteAttachments, setSiteAttachments] = useState<{ file_url: string; context: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  // Reassign Modal
  const [showReassignModal, setShowReassignModal] = useState(false)
  const [seniorTechId, setSeniorTechId] = useState('')
  const [reassignNotes, setReassignNotes] = useState('')

  // Mark Done Modal
  const [showMarkDoneModal, setShowMarkDoneModal] = useState(false)
  const [completionNotes, setCompletionNotes] = useState('')

  const supabase = createClient()

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
        .in('status', ESCALATED_STATUSES)
        .order('reopen_count', { ascending: false })
        .order('created_at', { ascending: true })

      if (fetchErr) throw fetchErr
      const list = (data as JobOrderRecord[]) || []
      setJobOrders(list)

      const { data: techs } = await supabase
        .from('users')
        .select('id, full_name, role')
        .in('role', ['MAINTENANCE', 'MANAGER', 'SUPER_ADMIN'])
        .order('full_name')
      setTechnicians((techs as TechnicianOption[]) || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load escalated queue.')
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

  // Load both site and reopen photo attachments for selected JO
  useEffect(() => {
    if (!selectedJO) {
      return
    }

    let isMounted = true

    const timer = window.setTimeout(() => {
      void (async () => {
        const { data } = await supabase
          .from('attachments')
          .select('file_url, context')
          .eq('entity_type', 'job_order')
          .eq('entity_id', selectedJO.id)
          .in('context', ['JO_SITE_PHOTO', 'JO_REOPEN_PHOTO'])

        if (!isMounted) return
        setSiteAttachments((data as { file_url: string; context: string }[]) || [])
      })()
    }, 0)

    return () => {
      isMounted = false
      window.clearTimeout(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJO])

  const handleReassign = async () => {
    if (!selectedJO || !seniorTechId) return
    setActionLoading(true)
    setError(null)
    try {
      await reassignEscalatedJobOrder({
        joId: selectedJO.id,
        seniorTechnicianId: seniorTechId,
        reassignmentNotes: reassignNotes,
      })
      setShowReassignModal(false)
      setSeniorTechId('')
      setReassignNotes('')
      setActionMessage(`✅ ${selectedJO.jo_number} reassigned to senior technician.`)
      await loadData()
      setSelectedJO(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reassign.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleMarkDone = async () => {

    await runLocked('Marking job order done…', async () => {
      if (!selectedJO) return
      setActionLoading(true)
      setError(null)
      try {
        await markJobOrderDone(selectedJO.id, completionNotes)
        setShowMarkDoneModal(false)
        setCompletionNotes('')
        setActionMessage(`✅ ${selectedJO.jo_number} marked COMPLETED by senior tech.`)
        await loadData()
        setSelectedJO(null)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to mark done.')
      } finally {
        setActionLoading(false)
      }

    })

  }

  const formattedCode = (jo: JobOrderRecord) =>
    jo.revision_suffix > 0
      ? `${jo.jo_number}-${String(jo.revision_suffix).padStart(2, '0')}`
      : jo.jo_number

  const getPriorityBadge = (p: JOPriority) => {
    switch (p) {
      case 'EMERGENCY': return 'bg-rose-950 text-rose-300 border-rose-800'
      case 'URGENT': return 'bg-amber-950 text-amber-300 border-amber-800'
      default: return 'bg-blue-950/60 text-blue-300 border-blue-900/60'
    }
  }

  const sitePhotos = siteAttachments.filter((a) => a.context === 'JO_SITE_PHOTO')
  const reopenPhotos = siteAttachments.filter((a) => a.context === 'JO_REOPEN_PHOTO')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/jo/queue"
          className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Escalated Issues
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-950 text-rose-400 border border-rose-900">
              FORM 4
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Re-assign persistent failures to a senior technician. Prior tech is locked out.
          </p>
        </div>
      </div>

      {/* Alert Banner */}
      <div className="flex items-start gap-3 p-4 bg-rose-950/30 border border-rose-800/60 rounded-2xl">
        <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        <div className="text-xs text-rose-200 leading-relaxed">
          <b className="block text-rose-300 font-bold mb-0.5">Critical Escalation Protocol</b>
          All tickets here have been reopened 2+ times. Assign a <b>senior technician</b> —
          the previous assignee will be locked out and an incident flag will be logged on their record.
          Manager review is required before close.
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-center justify-between">
          <span>{actionMessage}</span>
          <button type="button" onClick={() => setActionMessage(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400 gap-2 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-rose-400" />
          <span>Loading escalated cases...</span>
        </div>
      ) : jobOrders.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/60 border border-slate-800 rounded-2xl space-y-3">
          <AlertOctagon className="w-10 h-10 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-300 font-semibold">No escalated cases</p>
          <p className="text-xs text-slate-500">All critical issues have been resolved.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Escalated List */}
          <div className="space-y-2 lg:max-h-[720px] lg:overflow-y-auto pr-1">
            {jobOrders.map((jo) => (
              <button
                key={jo.id}
                type="button"
                onClick={() => setSelectedJO(jo)}
                className={`w-full text-left p-4 rounded-xl border transition-all space-y-2 ${
                  selectedJO?.id === jo.id
                    ? 'bg-slate-900 border-rose-500/70 shadow-lg shadow-rose-500/10'
                    : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-900/90'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-rose-400">{formattedCode(jo)}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getPriorityBadge(jo.priority)}`}>
                      {jo.priority}
                    </span>
                    <span className="flex items-center gap-0.5 text-[10px] font-bold text-rose-300 bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-800/60">
                      <AlertOctagon className="w-3 h-3" /> ×{jo.reopen_count}
                    </span>
                  </div>
                </div>
                <p className="text-xs font-medium text-slate-200 line-clamp-1">{jo.title}</p>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    <span className="truncate max-w-[110px]">{jo.location}</span>
                  </span>
                  <span className="text-rose-400 font-semibold">
                    {jo.status === 'CRITICAL_REOPEN_ESCALATED' ? 'CRITICAL' : 'REOPENED'}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  By: <span className="text-slate-400">{jo.requester?.full_name ?? 'Staff'}</span>
                  {jo.requester?.department?.department_name && (
                    <span> · {jo.requester.department.department_name}</span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Detail Panel */}
          {selectedJO ? (
            <div className="lg:col-span-2 bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-5">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-800">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-lg font-black text-rose-400">{formattedCode(selectedJO)}</span>
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black bg-rose-950 text-rose-300 border border-rose-800 animate-pulse">
                      <AlertOctagon className="w-3 h-3" /> CRITICAL — Reopen #{selectedJO.reopen_count}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${getPriorityBadge(selectedJO.priority)}`}>
                      {selectedJO.priority === 'EMERGENCY' && <Flame className="w-3 h-3 inline mr-1" />}
                      {selectedJO.priority === 'URGENT' && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                      {selectedJO.priority}
                    </span>
                  </div>
                  <h2 className="text-base font-bold text-white">{selectedJO.title}</h2>
                </div>
              </div>

              {/* Meta */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl text-xs">
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
                  <span className="text-slate-400 text-[11px] block">Previous Assignee:</span>
                  <span className="font-semibold text-rose-300/80 line-through flex items-center gap-1 mt-0.5 text-[11px]">
                    <Wrench className="w-3 h-3 text-rose-400/60 shrink-0" />
                    {selectedJO.assignee?.full_name || 'None'}
                  </span>
                  <span className="text-[10px] text-rose-400/60">(locked out)</span>
                </div>
              </div>

              {/* Timestamps */}
              <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-400 font-mono">
                <div>
                  <span className="block text-[10px] text-slate-500">SUBMITTED:</span>
                  <span>{new Date(selectedJO.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-500">STARTED:</span>
                  <span>{selectedJO.started_at ? new Date(selectedJO.started_at).toLocaleString() : '—'}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-500">LAST COMPLETED:</span>
                  <span>{selectedJO.completed_at ? new Date(selectedJO.completed_at).toLocaleString() : '—'}</span>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">Problem Description</span>
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {selectedJO.description}
                </div>
              </div>

              {/* Side-by-side Photo Comparison */}
              {(sitePhotos.length > 0 || reopenPhotos.length > 0) && (
                <div className="grid grid-cols-2 gap-4">
                  {sitePhotos.length > 0 && (
                    <div>
                      <span className="block text-[10px] text-slate-400 font-semibold mb-2 uppercase tracking-wider">Original Site Photo</span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {sitePhotos.slice(0, 4).map((att, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setLightboxImage(att.file_url)}
                            className="aspect-square rounded-lg overflow-hidden border border-slate-700 bg-slate-950 focus:outline-none"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={att.file_url} alt="Site" className="w-full h-full object-cover hover:scale-105 transition-transform" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {reopenPhotos.length > 0 && (
                    <div>
                      <span className="block text-[10px] text-rose-400 font-semibold mb-2 uppercase tracking-wider">Reopen / Failure Photo</span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {reopenPhotos.slice(0, 4).map((att, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setLightboxImage(att.file_url)}
                            className="aspect-square rounded-lg overflow-hidden border border-rose-900/60 bg-slate-950 focus:outline-none"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={att.file_url} alt="Reopen" className="w-full h-full object-cover hover:scale-105 transition-transform" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-end gap-3">
                {/* Accept & Re-Assign (CRITICAL_REOPEN_ESCALATED) */}
                {selectedJO.status === 'CRITICAL_REOPEN_ESCALATED' && (
                  <button
                    type="button"
                    onClick={() => { setSeniorTechId(''); setReassignNotes(''); setShowReassignModal(true) }}
                    className="flex items-center gap-1.5 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-colors shadow-lg shadow-rose-600/20"
                  >
                    <RotateCcw className="w-4 h-4" /> Accept & Re-Assign Senior Tech
                  </button>
                )}

                {/* Senior Tech marks done (REOPENED_UNRESOLVED or CRITICAL) */}
                {(selectedJO.status === 'REOPENED_UNRESOLVED' || selectedJO.status === 'CRITICAL_REOPEN_ESCALATED') && (
                  <button
                    type="button"
                    onClick={() => { setCompletionNotes(''); setShowMarkDoneModal(true) }}
                    className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors shadow-lg shadow-emerald-600/20"
                  >
                    <Clock className="w-4 h-4" /> Senior Tech Marks Done
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="lg:col-span-2 flex items-center justify-center bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center">
              <div className="space-y-2">
                <AlertOctagon className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-sm text-slate-400">Select an escalated case to review and act.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reassign Modal */}
      {showReassignModal && selectedJO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-slate-100">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-rose-400" />
              <h3 className="text-sm font-bold text-white">Accept & Re-Assign to Senior Tech</h3>
            </div>
            <p className="text-xs text-slate-300">
              Case: <b className="font-mono text-rose-400">{formattedCode(selectedJO)}</b><br />
              <span className="text-rose-300/70 text-[11px]">Previous technician will be locked out; incident flag logged on their record.</span>
            </p>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Senior Technician <span className="text-rose-400">*</span>:
              </label>
              <select
                value={seniorTechId}
                onChange={(e) => setSeniorTechId(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500"
              >
                <option value="">— Select Senior Technician —</option>
                {technicians.filter((t) => t.id !== selectedJO.assignee_id).map((t) => (
                  <option key={t.id} value={t.id}>{t.full_name} ({t.role})</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Incident / Reassignment Notes <span className="text-rose-400">*</span>:
              </label>
              <textarea
                rows={3}
                value={reassignNotes}
                onChange={(e) => setReassignNotes(e.target.value)}
                placeholder="Document reason for escalation and instructions for senior tech..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowReassignModal(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || !seniorTechId || !reassignNotes.trim()}
                onClick={handleReassign}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Confirm Reassignment
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
              <Clock className="w-5 h-5 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Senior Tech — Mark Complete</h3>
            </div>
            <p className="text-xs text-slate-300">
              Sets <b className="font-mono text-rose-400">{formattedCode(selectedJO)}</b> to{' '}
              <b className="text-emerald-300">COMPLETED</b> and notifies the requester for verification.
            </p>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">Resolution Notes:</label>
              <textarea
                rows={3}
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                placeholder="Describe root cause, permanent fix applied, or parts replaced..."
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

      {/* Lightbox */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 cursor-pointer"
          onClick={() => setLightboxImage(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-slate-800 text-white"
            onClick={() => setLightboxImage(null)}
          >
            <X className="w-5 h-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxImage}
            alt="Enlarged preview"
            className="max-w-full max-h-[90vh] object-contain rounded-xl"
          />
        </div>
      )}
    </div>
  )
}
