'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  FileText,
  PlusCircle,
  Search,
  Filter,
  Building,
  CheckCircle2,
  AlertTriangle,
  Zap,
  ExternalLink,
  Loader2,
  Clock,
  ArrowUpDown,
  Boxes,
  ClipboardCheck,
  ShoppingBag,
  PackageCheck,
  FileSearch,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { postAuditFastTrack } from '@/lib/actions/mrs-actions'

interface MRSListing {
  id: number
  mrs_number: string
  request_type: string
  purpose: string
  created_at: string
  overall_status: string
  total_estimated_cost: number
  allocated_budget: number | null
  total_actual_spent: number | null
  manager_rejection_reason: string | null
  owner_rejection_reason: string | null
  is_emergency_fast_track: boolean
  fast_track_audited_at: string | null
  department: { department_name: string } | null
  requester: { full_name: string } | null
  job_order: { jo_number: string; title: string } | null
}

export default function MRSLogPage() {
  const [list, setList] = useState<MRSListing[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [userRole, setUserRole] = useState('')
  const [submittingAudit, setSubmittingAudit] = useState<number | null>(null)
  const [auditSuccess, setAuditSuccess] = useState<string | null>(null)

  const supabase = createClient()

  const fetchRequisitions = async () => {
    setLoading(true)
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
        }
      }

      const { data, error } = await supabase
        .from('material_requisitions')
        .select(`
          id, mrs_number, request_type, purpose, created_at, overall_status,
          total_estimated_cost, allocated_budget, total_actual_spent,
          manager_rejection_reason, owner_rejection_reason,
          is_emergency_fast_track, fast_track_audited_at,
          department:departments(department_name),
          requester:users!material_requisitions_requester_id_fkey(full_name),
          job_order:job_orders!material_requisitions_jo_id_fkey(jo_number, title)
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setList((data as any) || [])
    } catch (err: unknown) {
      console.error('Error fetching requisitions:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRequisitions()
  }, [])

  const handlePostAudit = async (mrsId: number, mrsNumber: string) => {
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
        : item.overall_status === statusFilter)

    const matchesType = typeFilter === 'ALL' || item.request_type === typeFilter

    return matchesSearch && matchesStatus && matchesType
  })

  const canAudit = ['SUPER_ADMIN', 'MANAGER', 'BUDGET_OFFICER'].includes(userRole)

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
        <Link
          href="/mrs/stock-check"
          className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 shrink-0 transition-colors"
        >
          <Boxes className="w-3.5 h-3.5 text-amber-400" />
          <span>Form 6: Stock Check</span>
        </Link>
        <Link
          href="/mrs/manager-queue"
          className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 shrink-0 transition-colors"
        >
          <ClipboardCheck className="w-3.5 h-3.5 text-blue-400" />
          <span>Form 7: Manager Approval</span>
        </Link>
        <Link
          href="/mrs/canvass"
          className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 shrink-0 transition-colors"
        >
          <FileSearch className="w-3.5 h-3.5 text-purple-400" />
          <span>Form 8: Canvass & Snapshot</span>
        </Link>
        <Link
          href="/purchaser/queue"
          className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 shrink-0 transition-colors"
        >
          <ShoppingBag className="w-3.5 h-3.5 text-emerald-400" />
          <span>Form 13: Purchaser Queue</span>
        </Link>
        <Link
          href="/delivery/verify"
          className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 shrink-0 transition-colors"
        >
          <PackageCheck className="w-3.5 h-3.5 text-teal-400" />
          <span>Form 14: Delivery Sign-Off</span>
        </Link>
      </div>

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
            <option value="PENDING_MANAGER">Pending Manager</option>
            <option value="IN_CANVASSING">In Canvassing</option>
            <option value="PENDING_OWNER">Pending Owner</option>
            <option value="APPROVED_READY_TO_ORDER">Approved (Ready to Order)</option>
            <option value="PURCHASING">Purchasing</option>
            <option value="FULFILLED">Fulfilled</option>
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
                          <span>{item.mrs_number}</span>
                          {item.is_emergency_fast_track && (
                            <span title="Emergency Fast-Track">
                              <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 font-sans block">
                          {new Date(item.created_at).toLocaleDateString()}
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
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
