'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  FileText,
  PlusCircle,
  Search,
  CheckCircle2,
  Zap,
  ExternalLink,
  Loader2,
  Clock,
  ClipboardCheck,
  ShoppingBag,
  PackageCheck,
  FileSearch,
  Eye,
  X,
  PackageX,
  AlertTriangle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useCachedList } from '@/lib/cache/useCachedList'
import { postAuditFastTrack } from '@/lib/actions/mrs-actions'
import { requesterAvailabilityDecision } from '@/lib/actions/purchaser-actions'
import {
  FAST_TRACK_AUDIT_ROLES,
  MRS_0013_DEFAULTS,
  PG_UNDEFINED_COLUMN,
  REQUESTER_DECISION_LABELS,
  isAwaitingRequesterDecision,
  outstandingSpareChange,
  type RequesterDecision,
} from '@/lib/status-machines'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'
import { canViewRoute } from '@/lib/access-control'
import type { UserRole } from '@/types/index'
import { useActionLock } from '@/components/ui/ActionLock'
import { formatDate, formatDateTime } from '@/lib/format-date'

interface MRSLineItem {
  id: number
  item_description: string
  qty_requested: number
  qty_issued_from_stock: number
  unit: string
  store_name: string | null
  est_unit_price: number
  reference_photo_url: string | null
  qty_available: number | null
  availability_note: string | null
}

interface MRSListing {
  id: number
  mrs_number: string
  request_type: string
  purpose: string
  created_at: string | null
  overall_status: string
  total_estimated_cost: number
  allocated_budget: number | null
  total_actual_spent: number | null
  manager_rejection_reason: string | null
  owner_rejection_reason: string | null
  is_emergency_fast_track: boolean
  fast_track_audited_at: string | null
  availability_hold: boolean
  availability_notes: string | null
  requester_decision: string
  requester_decision_notes: string | null
  spare_change_required: number | null
  spare_change_returned: number | null
  department_id: number | null
  is_online_purchase?: boolean
  online_supplier_url?: string | null
  attachments?: { id: number; file_url: string; context: string }[]
  est_shipping_fee?: number | null
  department: { department_name: string } | null
  requester: { full_name: string } | null
  job_order: { jo_number: string; title: string } | null
  mrs_line_items?: MRSLineItem[]
}

export default function MRSLogPage() {
  const { runLocked } = useActionLock()
  const { seed, hadSeed, loading, setLoading, refreshing, commit } =
    useCachedList<MRSListing[]>('mrs:list')
  const [list, setList] = useState<MRSListing[]>(seed ?? [])
  const [selectedMRS, setSelectedMRS] = useState<MRSListing | null>(null)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [lightboxTitle, setLightboxTitle] = useState<string>('Item Photo')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [userRole, setUserRole] = useState('')
  const [viewerDeptId, setViewerDeptId] = useState<number | null>(null)
  const [decisionNotes, setDecisionNotes] = useState('')
  const [submittingDecision, setSubmittingDecision] = useState(false)
  // True when migration 0013 has not been applied to this Supabase project.
  const [migrationPending, setMigrationPending] = useState(false)
  const [submittingAudit, setSubmittingAudit] = useState<number | null>(null)
  const [auditSuccess, setAuditSuccess] = useState<string | null>(null)

  const supabase = createClient()

  const fetchRequisitions = useCallback(async () => {
    if (!hadSeed) setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('role, department_id')
          .eq('id', user.id)
          .single()

        if (profile) {
          setUserRole(profile.role)
          setViewerDeptId((profile as { department_id?: number | null }).department_id ?? null)
        }
      }

      const { data, error } = await supabase
        .from('material_requisitions')
        .select(`
          id, mrs_number, request_type, purpose, created_at, overall_status,
          total_estimated_cost, allocated_budget, total_actual_spent,
          manager_rejection_reason, owner_rejection_reason,
          is_emergency_fast_track, fast_track_audited_at,
          availability_hold, availability_notes, requester_decision, requester_decision_notes,
          spare_change_required, spare_change_returned, department_id,
          is_online_purchase, online_supplier_url, est_shipping_fee,
          department:departments(department_name),
          requester:users!material_requisitions_requester_id_fkey(full_name),
          job_order:job_orders!material_requisitions_jo_id_fkey(jo_number, title),
          mrs_line_items(id, item_description, qty_requested, qty_issued_from_stock, unit, store_name, est_unit_price, reference_photo_url, qty_available, availability_note)
        `)
        .order('created_at', { ascending: false })

      let rows = data
      if (error) {
        // Migration 0013 not applied → 42703 fails the entire query and the
        // ledger would render empty (agent_handoff Rule 7). Retry without the
        // 0013 columns and fill in safe defaults.
        if (error.code === PG_UNDEFINED_COLUMN) {
          const legacy = await supabase
            .from('material_requisitions')
            .select(`
              id, mrs_number, request_type, purpose, created_at, overall_status,
              total_estimated_cost, allocated_budget, total_actual_spent,
              manager_rejection_reason, owner_rejection_reason,
              is_emergency_fast_track, fast_track_audited_at, department_id,
              is_online_purchase, online_supplier_url, est_shipping_fee,
              department:departments(department_name),
              requester:users!material_requisitions_requester_id_fkey(full_name),
              job_order:job_orders!material_requisitions_jo_id_fkey(jo_number, title),
              mrs_line_items(id, item_description, qty_requested, qty_issued_from_stock, unit, store_name, est_unit_price, reference_photo_url)
            `)
            .order('created_at', { ascending: false })

          if (legacy.error) throw legacy.error
          setMigrationPending(true)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rows = (legacy.data as any[]).map(row => ({
            ...row,
            ...MRS_0013_DEFAULTS,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mrs_line_items: (row.mrs_line_items || []).map((li: any) => ({
              ...li,
              qty_available: null,
              availability_note: null,
            })),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          })) as any
        } else {
          throw error
        }
      }

      const mrsIds = (rows || []).map((r: { id: number }) => r.id)
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

      const merged = (rows || []).map((row: MRSListing) => ({
        ...row,
        attachments: screenshotsMap[row.id]
          ? [{ id: row.id, file_url: screenshotsMap[row.id], context: 'MRS_ONLINE_SCREENSHOT' }]
          : [],
      }))
      setList(merged)
      commit(merged)
    } catch (err: unknown) {
      console.error('Error fetching requisitions:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase, hadSeed, setLoading, commit])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchRequisitions()
  }, [fetchRequisitions])

  const handlePostAudit = async (mrsId: number, mrsNumber: string) => {

    await runLocked('Stamping post-audit…', async () => {
      setSubmittingAudit(mrsId)
      setAuditSuccess(null)
      try {
        await postAuditFastTrack(mrsId)
        setAuditSuccess(`24-Hour Post-Audit stamped for ${mrsNumber}!`)
        fetchRequisitions()
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Audit failed.')
      } finally {
        setSubmittingAudit(null)
      }

    })

  }

  // 0013 — requester answers the purchaser's availability report
  const handleAvailabilityDecision = async (
    mrs: MRSListing,
    decision: Exclude<RequesterDecision, 'NONE' | 'PENDING'>
  ) => {
    await runLocked('Recording your decision…', async () => {
      setSubmittingDecision(true)
      try {
        const res = await requesterAvailabilityDecision({
          mrsId: mrs.id,
          decision,
          notes: decisionNotes.trim() || undefined,
        })
        setAuditSuccess(
          res.purchaseReleased
            ? `Decision saved for ${mrs.mrs_number}: ${REQUESTER_DECISION_LABELS[decision]}. The purchaser may now buy the available quantity.`
            : `Decision saved for ${mrs.mrs_number}: the purchase is held until the full quantity is available.`
        )
        setDecisionNotes('')
        setSelectedMRS(null)
        fetchRequisitions()
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Failed to record the decision.')
      } finally {
        setSubmittingDecision(false)
      }
    })
  }

  // Filtered list
  const filtered = list.filter(item => {
    const matchesSearch =
      item.mrs_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.purpose.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.job_order?.jo_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.requester?.full_name || '').toLowerCase().includes(searchTerm.toLowerCase())

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'PENDING_AUDIT'
        ? item.is_emergency_fast_track && !item.fast_track_audited_at
        : statusFilter === 'AVAILABILITY_HOLD'
          ? isAwaitingRequesterDecision(item)
          : item.overall_status === statusFilter)

    const matchesType = typeFilter === 'ALL' || item.request_type === typeFilter

    return matchesSearch && matchesStatus && matchesType
  })

  // Plan §6.A step 3 — the 24-hour post-audit belongs to a Manager or Budget
  // Officer. Same list the server gate uses (postAuditFastTrack → audit §A2), so
  // the button never offers an action that will be refused.
  const canAudit = (FAST_TRACK_AUDIT_ROLES as readonly string[]).includes(userRole)

  // 0013 Gate A — the availability decision belongs to the requesting
  // department (mirror of requesterAvailabilityDecision()'s server-side rule).
  const canDecideAvailability =
    userRole === 'SUPER_ADMIN' ||
    (selectedMRS !== null &&
      viewerDeptId !== null &&
      selectedMRS.department_id === viewerDeptId)
  const quickLinks = [
    { href: '/mrs/manager-queue', label: 'Form 7: Manager Approval', icon: <ClipboardCheck className="w-3.5 h-3.5 text-blue-400" /> },
    { href: '/mrs/canvass', label: 'Form 8: Canvass & Snapshot', icon: <FileSearch className="w-3.5 h-3.5 text-purple-400" /> },
    { href: '/purchaser/queue', label: 'Form 13: Purchaser Queue', icon: <ShoppingBag className="w-3.5 h-3.5 text-emerald-400" /> },
    { href: '/delivery/verify', label: 'Form 14: Delivery Sign-Off', icon: <PackageCheck className="w-3.5 h-3.5 text-teal-400" /> },
  ].filter(link => canViewRoute(userRole as UserRole, link.href))

  return (
    <div className="space-y-6">
      {/* Header & Quick Navigation Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-500" />
            <h1 className="text-xl font-black text-white tracking-tight">
              Material Requisitions Ledger
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Form 9 — Master procurement log, 24-hour fast-track post-audit, and department status tracking.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/mrs/new"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-blue-500/20 transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            <span>New Requisition (Form 5)</span>
          </Link>
        </div>
      </div>

      {/* Module Quick Nav Shortcuts */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-semibold">
        {quickLinks.map(link => (
          <Link
            key={link.href}
            href={link.href}
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 shrink-0 transition-colors"
          >
            {link.icon}
            <span>{link.label}</span>
          </Link>
        ))}
      </div>

      {migrationPending && (
        <div className="p-3 bg-amber-950/40 border border-amber-800 rounded-xl text-xs text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Availability holds and spare-change tracking are inactive — migration{' '}
            <span className="font-mono">0013_availability_and_spare_change_gates.sql</span> has not been
            applied to this Supabase project yet.
          </span>
        </div>
      )}

      {auditSuccess && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{auditSuccess}</span>
        </div>
      )}

      {/* Filter Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search MRS #, purpose, JO code, requester..."
            className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="PENDING_AUDIT">⚡ Pending Post-Audit</option>
            <option value="AVAILABILITY_HOLD">⏸ Availability Hold (Your Decision)</option>
            <option value="PENDING_MANAGER">Pending Manager</option>
            <option value="IN_CANVASSING">In Canvassing</option>
            <option value="PENDING_OWNER">Pending Owner</option>
            <option value="APPROVED_READY_TO_ORDER">Approved (Ready to Order)</option>
            <option value="TRANSMITTAL_IN_PROGRESS">Transmittal In Progress</option>
            <option value="READY_FOR_PURCHASE">Ready For Purchase</option>
            <option value="PURCHASING">Purchasing</option>
            <option value="IN_TRANSIT">In Transit</option>
            <option value="FULFILLED">Fulfilled</option>
            <option value="PARTIALLY_FULFILLED_BUDGET_EXHAUSTED">Partially Fulfilled</option>
            <option value="ISSUED_FROM_STOCK">Issued From Stock</option>
            <option value="DISPUTED">Disputed</option>
            <option value="CLOSED">Closed</option>
            <option value="MANAGER_REJECTED">Manager Rejected</option>
            <option value="OWNER_REJECTED">Owner Rejected</option>
            <option value="VOIDED">Voided</option>
          </select>

          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none"
          >
            <option value="ALL">All Types</option>
            <option value="JOB_ORDER">Job Order Linked</option>
            <option value="STANDALONE">Standalone</option>
          </select>
        </div>
      </div>

      {/* Table / Ledger */}
      {loading ? (
        <div className="py-20 text-center text-slate-400 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mr-3" />
          <span>Loading ledger data...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-2">
          <FileText className="w-8 h-8 mx-auto text-slate-600" />
          <p className="text-sm font-semibold">No requisitions match filters</p>
          <p className="text-xs text-slate-500">Try adjusting your search criteria or create a new MRS.</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">MRS Number</th>
                  <th className="py-3 px-4">Department / Requester</th>
                  <th className="py-3 px-4">Scope / Purpose</th>
                  <th className="py-3 px-4">Linked JO</th>
                  <th className="py-3 px-4">Budget / Spent</th>
                  <th className="py-3 px-4">Status & Audit</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filtered.map(item => {
                  const isFastTrackUnaudited =
                    item.is_emergency_fast_track && !item.fast_track_audited_at

                  return (
                    <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                      {/* MRS Code */}
                      <td className="py-3.5 px-4 font-mono font-bold text-white whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/audit-logs/material_requisition/${item.id}`} className="hover:text-cyan-300" title="View audit history">
                            {item.mrs_number}
                          </Link>
                          {item.is_emergency_fast_track && (
                            <span title="Emergency Fast-Track">
                              <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 font-sans block">
                          {formatDate(item.created_at)}
                        </span>
                      </td>

                      {/* Department / Requester */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-semibold text-slate-200">
                          {item.department?.department_name ?? 'General'}
                        </div>
                        <span className="text-[11px] text-slate-400">
                          {item.requester?.full_name ?? 'Staff'}
                        </span>
                      </td>

                      {/* Purpose */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="line-clamp-2 text-slate-300">{item.purpose}</p>
                        {item.manager_rejection_reason && (
                          <span className="text-[10px] text-rose-400 block mt-1">
                            Rejection: {item.manager_rejection_reason}
                          </span>
                        )}
                        {item.owner_rejection_reason && (
                          <span className="text-[10px] text-rose-400 block mt-1">
                            Owner Rejection: {item.owner_rejection_reason}
                          </span>
                        )}
                      </td>

                      {/* Linked JO */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {item.job_order ? (
                          <Link
                            href="/jo/track"
                            className="font-mono text-blue-400 hover:text-blue-300 font-semibold"
                          >
                            {item.job_order.jo_number}
                          </Link>
                        ) : (
                          <span className="text-slate-500">Standalone</span>
                        )}
                      </td>

                      {/* Financials */}
                      <td className="py-3.5 px-4 whitespace-nowrap font-mono">
                        <div className="text-slate-200 font-bold">
                          Alloc: ₱{Number(item.allocated_budget || item.total_estimated_cost).toFixed(2)}
                        </div>
                        {item.total_actual_spent !== null && item.total_actual_spent > 0 && (
                          <span className="text-emerald-400 text-[11px] block">
                            Spent: ₱{Number(item.total_actual_spent).toFixed(2)}
                          </span>
                        )}
                      </td>

                      {/* Status & Fast-Track Audit */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-1.5">
                          <span className="inline-block px-2.5 py-0.5 rounded text-[10px] font-bold bg-slate-950 border border-slate-800 text-slate-300">
                            {item.overall_status}
                          </span>

                          {/* 0013 — availability hold awaiting the requester */}
                          {isAwaitingRequesterDecision(item) && (
                            <span className="px-2 py-0.5 rounded bg-amber-950 border border-amber-800 text-amber-300 text-[10px] font-bold flex items-center gap-1 w-fit">
                              <PackageX className="w-3 h-3 shrink-0" />
                              <span>Availability — Your Decision Needed</span>
                            </span>
                          )}

                          {/* 0013 — spare change still owed to Accounting */}
                          {outstandingSpareChange(item) > 0 && (
                            <span className="px-2 py-0.5 rounded bg-rose-950 border border-rose-800 text-rose-300 text-[10px] font-bold flex items-center gap-1 w-fit">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>Spare change due: ₱{outstandingSpareChange(item).toFixed(2)}</span>
                            </span>
                          )}

                          {/* Emergency Fast-Track Pending Post-Audit Badge (Plan.md §6.A step 3) */}
                          {isFastTrackUnaudited && (
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded bg-amber-950 border border-amber-800 text-amber-300 text-[10px] font-bold flex items-center gap-1">
                                <Clock className="w-3 h-3 text-amber-400 animate-pulse" />
                                <span>Pending Post-Audit</span>
                              </span>

                              {canAudit && (
                                <button
                                  type="button"
                                  disabled={submittingAudit === item.id}
                                  onClick={() => handlePostAudit(item.id, item.mrs_number)}
                                  className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-[10px] font-bold transition-colors disabled:opacity-50"
                                >
                                  {submittingAudit === item.id ? '...' : 'Verify Audit'}
                                </button>
                              )}
                            </div>
                          )}

                          {item.fast_track_audited_at && (
                            <span className="text-[10px] text-emerald-400 block font-semibold">
                              ✓ Post-Audit Complete
                            </span>
                          )}
                        </div>
                      </td>

                      {/* View Details Action */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedMRS(item)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-blue-600/20 text-slate-300 hover:text-blue-400 border border-slate-700/80 hover:border-blue-500/50 text-xs font-semibold transition-all shadow-sm"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Details</span>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Requisition Details Slide-over / Modal with Attached Photos */}
      {selectedMRS && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
          onClick={() => setSelectedMRS(null)}
        >
          <div
            className="relative max-w-2xl w-full max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-purple-950/80 border border-purple-800 text-purple-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-mono text-base font-black text-white">
                      {selectedMRS.mrs_number}
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-950 border border-slate-800 text-slate-300">
                      {selectedMRS.overall_status}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    Submitted on {formatDateTime(selectedMRS.created_at)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedMRS(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5">
              {/* Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs">
                <div>
                  <span className="text-[11px] text-slate-400 block">Department:</span>
                  <span className="font-semibold text-white">
                    {selectedMRS.department?.department_name || 'General'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">Requester:</span>
                  <span className="font-semibold text-white">
                    {selectedMRS.requester?.full_name || 'Staff'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">Allocated Budget:</span>
                  <span className="font-semibold text-emerald-400 font-mono">
                    ₱{Number(selectedMRS.allocated_budget || selectedMRS.total_estimated_cost).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* 0013 — Availability decision panel (requester's department) */}
              {isAwaitingRequesterDecision(selectedMRS) && (
                <div className="p-4 bg-amber-950/30 border border-amber-800 rounded-xl space-y-3">
                  <div className="flex items-center gap-2">
                    <PackageX className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-xs font-bold text-amber-200">
                      The purchaser could not source everything — your decision is required
                    </span>
                  </div>

                  {selectedMRS.availability_notes && (
                    <p className="text-[11px] text-amber-200/90 bg-slate-950/60 rounded-lg px-3 py-2">
                      {selectedMRS.availability_notes}
                    </p>
                  )}

                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden bg-slate-950">
                    {(selectedMRS.mrs_line_items ?? []).map(line => {
                      const outstanding = Math.max(0, line.qty_requested - line.qty_issued_from_stock)
                      const available = line.qty_available
                      const isShort = available !== null && available !== undefined && available < outstanding
                      return (
                        <div key={line.id} className="px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-slate-200 font-semibold">{line.item_description}</span>
                          <span className={isShort ? 'text-amber-300 font-bold' : 'text-slate-400'}>
                            {available ?? outstanding} of {outstanding} {line.unit} available
                            {line.availability_note ? ` — ${line.availability_note}` : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>

                  {canDecideAvailability ? (
                    <>
                      <textarea
                        rows={2}
                        value={decisionNotes}
                        onChange={e => setDecisionNotes(e.target.value)}
                        placeholder="Optional note for the purchaser (e.g. an acceptable substitute brand)..."
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={submittingDecision}
                          onClick={() => handleAvailabilityDecision(selectedMRS, 'PROCEED_PARTIAL')}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors"
                        >
                          Proceed with What&apos;s Available
                        </button>
                        <button
                          type="button"
                          disabled={submittingDecision}
                          onClick={() => handleAvailabilityDecision(selectedMRS, 'CANCEL_REMAINING')}
                          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors"
                        >
                          Buy Available & Cancel Balance
                        </button>
                        <button
                          type="button"
                          disabled={submittingDecision}
                          onClick={() => handleAvailabilityDecision(selectedMRS, 'WAIT_FULL')}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition-colors"
                        >
                          Wait for Full Availability
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-amber-300/80">
                      Only users in the requesting department (
                      {selectedMRS.department?.department_name ?? 'requester'}) or a Super Admin can decide.
                    </p>
                  )}
                </div>
              )}

              {/* 0013 — decision already recorded */}
              {!isAwaitingRequesterDecision(selectedMRS) &&
                selectedMRS.requester_decision !== 'NONE' && (
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-1">
                    <span className="text-[11px] text-slate-400 block">Availability decision:</span>
                    <span className="font-semibold text-white">
                      {REQUESTER_DECISION_LABELS[selectedMRS.requester_decision as RequesterDecision] ??
                        selectedMRS.requester_decision}
                    </span>
                    {selectedMRS.requester_decision_notes && (
                      <p className="text-[11px] text-slate-300">{selectedMRS.requester_decision_notes}</p>
                    )}
                  </div>
                )}

              {/* 0013 — spare change reconciliation status */}
              {Number(selectedMRS.spare_change_required ?? 0) > 0 && (
                <div
                  className={`p-3 rounded-xl border text-xs space-y-1 ${
                    outstandingSpareChange(selectedMRS) > 0
                      ? 'bg-rose-950/30 border-rose-800 text-rose-200'
                      : 'bg-emerald-950/30 border-emerald-800 text-emerald-200'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {outstandingSpareChange(selectedMRS) > 0
                        ? `Spare change outstanding: ₱${outstandingSpareChange(selectedMRS).toFixed(2)}`
                        : 'Spare change fully reconciled'}
                    </span>
                  </div>
                  <p className="text-[11px] opacity-90 font-mono">
                    Required ₱{Number(selectedMRS.spare_change_required ?? 0).toFixed(2)} · Returned ₱
                    {Number(selectedMRS.spare_change_returned ?? 0).toFixed(2)}
                  </p>
                  {outstandingSpareChange(selectedMRS) > 0 && (
                    <p className="text-[11px] opacity-90">
                      Accounting cannot close this requisition until the full amount is handed back (Form 11).
                    </p>
                  )}
                </div>
              )}

              {/* Purpose */}
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                  Purpose / Justification
                </span>
                <p className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl text-xs text-slate-200 leading-relaxed">
                  {selectedMRS.purpose}
                </p>
              </div>

              {/* Linked Job Order if any */}
              {selectedMRS.job_order && (
                <div className="p-3 bg-blue-950/30 border border-blue-900/50 rounded-xl flex items-center justify-between text-xs">
                  <span className="text-blue-300">
                    Linked Job Order: <strong>{selectedMRS.job_order.jo_number}</strong> — {selectedMRS.job_order.title}
                  </span>
                  <Link
                    href={`/jo/track`}
                    className="text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1"
                  >
                    <span>Track JO</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}

              {/* Line Items & Reference Photos */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                  Line Items & Attached Photos ({(selectedMRS.mrs_line_items || []).length})
                </span>

                {selectedMRS.mrs_line_items && selectedMRS.mrs_line_items.length > 0 ? (
                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    {selectedMRS.mrs_line_items.map((item, idx) => (
                      <div key={item.id || idx} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="space-y-1 flex-1">
                          <span className="font-semibold text-white block">
                            {item.item_description}
                          </span>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
                            <span>Qty: <strong>{item.qty_requested} {item.unit}</strong></span>
                            {item.store_name && <span>Store: {item.store_name}</span>}
                            <span>Est: ₱{Number(item.est_unit_price).toFixed(2)}</span>
                          </div>
                        </div>

                        {/* Attached Item Reference Photo Preview & Button */}
                        {item.reference_photo_url ? (
                          <div className="flex items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.reference_photo_url}
                              alt={item.item_description}
                              className="w-10 h-10 rounded-lg object-cover border border-slate-700 cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => {
                                setLightboxTitle(`${item.item_description} (Reference Photo)`)
                                setLightboxImage(item.reference_photo_url)
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setLightboxTitle(`${item.item_description} (Reference Photo)`)
                                setLightboxImage(item.reference_photo_url)
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5 text-blue-400" />
                              <span>View Photo</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">No photo</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic p-3 bg-slate-950 border border-slate-800 rounded-xl">
                    No individual line items detailed.
                  </p>
                )}
              </div>

              {/* Online Screenshot Preview (if online purchase) */}
              {selectedMRS.is_online_purchase && (
                <div className="p-4 bg-indigo-950/30 border border-indigo-900/50 rounded-xl space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-indigo-300">Online Purchase Order Details</span>
                    {selectedMRS.online_supplier_url && (
                      <a
                        href={selectedMRS.online_supplier_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-bold"
                      >
                        <span>Supplier Link</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  {(() => {
                    const screenshotAttachment = selectedMRS.attachments?.find(a => a.context === 'MRS_ONLINE_SCREENSHOT')
                    return screenshotAttachment ? (
                      <div className="flex items-center gap-3 pt-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={screenshotAttachment.file_url}
                          alt="Cart Screenshot"
                          className="w-14 h-14 rounded-lg object-cover border border-indigo-700 cursor-pointer"
                          onClick={() => {
                            setLightboxTitle(`Cart / Price Screenshot (${selectedMRS.mrs_number})`)
                            setLightboxImage(screenshotAttachment.file_url)
                          }}
                        />
                        <div>
                          <span className="text-xs text-slate-200 font-semibold block">Cart / Price Screenshot</span>
                          <button
                            type="button"
                            onClick={() => {
                              setLightboxTitle(`Cart / Price Screenshot (${selectedMRS.mrs_number})`)
                              setLightboxImage(screenshotAttachment.file_url)
                            }}
                            className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Screenshot</span>
                          </button>
                        </div>
                      </div>
                    ) : null
                  })()}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setSelectedMRS(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Photo Lightbox Modal */}
      <PhotoLightbox
        isOpen={Boolean(lightboxImage)}
        onClose={() => setLightboxImage(null)}
        imageUrl={lightboxImage}
        title={lightboxTitle}
      />
    </div>
  )
}
