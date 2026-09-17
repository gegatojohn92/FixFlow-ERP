'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  DollarSign,
  TrendingDown,
  TrendingUp,
  FileText,
  X,
  ArrowRight,
  Loader2,
} from 'lucide-react'

interface MRSSummary {
  id: number
  mrs_number: string
  purpose: string
  overall_status: string | null
  allocated_budget: number | null
  total_actual_spent: number | null
  spare_change_amount: number | null
  budget_variance_amount: number | null
  is_emergency_fast_track: boolean | null
  jo_id: number | null
  department_id: number
  created_at: string | null
  requester_name: string
  department_name: string
  jo_number: string | null
}

interface TransmittalSummary {
  id: number
  transmittal_number: string
  transmittal_type: string
  amount: number
  sender_status: string
  receiver_status: string
  created_at: string | null
}

interface LineItemDetail {
  id: number
  item_description: string
  qty_requested: number
  qty_fulfilled: number
  unit: string
  est_unit_price: number
  actual_unit_price: number
  store_name: string | null
  vendor_rating: number
  is_overpriced: boolean
  item_delivery_status: string
}

function SortIcon({ field, sortField, sortAsc }: { field: 'created_at' | 'allocated_budget' | 'total_actual_spent'; sortField: 'created_at' | 'allocated_budget' | 'total_actual_spent'; sortAsc: boolean }) {
  if (sortField !== field) return null
  return sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
}

export default function ExpenseReportPage() {
  const supabase = createBrowserClient()

  const [summaries, setSummaries] = useState<MRSSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMrs, setSelectedMrs] = useState<MRSSummary | null>(null)
  const [modalItems, setModalItems] = useState<LineItemDetail[]>([])
  const [modalTransmittals, setModalTransmittals] = useState<TransmittalSummary[]>([])
  const [modalLoading, setModalLoading] = useState(false)

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [deptFilter, setDeptFilter] = useState<string>('ALL')
  const [departments, setDepartments] = useState<{ id: number; department_name: string }[]>([])

  // Sort
  const [sortField, setSortField] = useState<'created_at' | 'allocated_budget' | 'total_actual_spent'>('created_at')
  const [sortAsc, setSortAsc] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)

    // Fetch departments for filter dropdown
    const { data: depts } = await supabase
      .from('departments')
      .select('id, department_name')
      .order('department_name')
    setDepartments(depts || [])

    // Fetch MRS records
    const { data: mrsData } = await supabase
      .from('material_requisitions')
      .select('id, mrs_number, purpose, overall_status, allocated_budget, total_actual_spent, spare_change_amount, budget_variance_amount, is_emergency_fast_track, jo_id, department_id, created_at, requester_id')
      .order('created_at', { ascending: false })

    if (!mrsData) {
      setSummaries([])
      setLoading(false)
      return
    }

    // Batch fetch requesters, departments, JOs
    const requesterIds = [...new Set(mrsData.map(m => m.requester_id))]
    const deptIds = [...new Set(mrsData.map(m => m.department_id))]
    const joIds = mrsData.filter(m => m.jo_id).map(m => m.jo_id!) 

    const [usersRes, deptsRes, josRes] = await Promise.all([
      requesterIds.length ? supabase.from('users').select('id, full_name').in('id', requesterIds) : { data: [] },
      deptIds.length ? supabase.from('departments').select('id, department_name').in('id', deptIds) : { data: [] },
      joIds.length ? supabase.from('job_orders').select('id, jo_number').in('id', joIds) : { data: [] },
    ])

    const userMap = new Map((usersRes.data || []).map(u => [u.id, u.full_name]))
    const deptMap = new Map((deptsRes.data || []).map(d => [d.id, d.department_name]))
    const joMap = new Map((josRes.data || []).map(j => [j.id, j.jo_number]))

    const enriched: MRSSummary[] = mrsData.map(m => ({
      id: m.id,
      mrs_number: m.mrs_number,
      purpose: m.purpose,
      overall_status: m.overall_status,
      allocated_budget: m.allocated_budget,
      total_actual_spent: m.total_actual_spent,
      spare_change_amount: m.spare_change_amount,
      budget_variance_amount: m.budget_variance_amount,
      is_emergency_fast_track: m.is_emergency_fast_track,
      jo_id: m.jo_id,
      department_id: m.department_id,
      created_at: m.created_at,
      requester_name: userMap.get(m.requester_id) || 'Unknown',
      department_name: deptMap.get(m.department_id) || 'Unknown',
      jo_number: m.jo_id ? (joMap.get(m.jo_id) || null) : null,
    }))

    setSummaries(enriched)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadData])

  // Apply filters
  const filtered = summaries.filter(m => {
    if (statusFilter !== 'ALL' && m.overall_status !== statusFilter) return false
    if (deptFilter !== 'ALL' && m.department_id !== Number(deptFilter)) return false
    if (dateFrom && (!m.created_at || m.created_at < dateFrom)) return false
    if (dateTo && (!m.created_at || m.created_at > dateTo + 'T23:59:59')) return false
    return true
  })

  // Apply sort
  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortField]
    const bVal = b[sortField]
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    return sortAsc ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal)
  })

  // Summary metrics
  const totalAllocated = filtered.reduce((s, m) => s + Number(m.allocated_budget || 0), 0)
  const totalSpent = filtered.reduce((s, m) => s + Number(m.total_actual_spent || 0), 0)
  const totalSpareChange = filtered.reduce((s, m) => s + Number(m.spare_change_amount || 0), 0)
  const totalVariance = totalAllocated - totalSpent

  function handleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(false)
    }
  }

  // DeepLinkModal
  async function openDeepLink(mrs: MRSSummary) {
    setSelectedMrs(mrs)
    setModalLoading(true)
    setModalItems([])
    setModalTransmittals([])

    const [itemsRes, trRes] = await Promise.all([
      supabase
        .from('mrs_line_items')
        .select('id, item_description, qty_requested, qty_fulfilled, unit, est_unit_price, actual_unit_price, store_name, vendor_rating, is_overpriced, item_delivery_status')
        .eq('mrs_id', mrs.id),
      supabase
        .from('transmittal_forms')
        .select('id, transmittal_number, transmittal_type, amount, sender_status, receiver_status, created_at')
        .eq('mrs_id', mrs.id)
        .order('created_at', { ascending: false }),
    ])

    setModalItems((itemsRes.data as LineItemDetail[]) || [])
    setModalTransmittals((trRes.data as TransmittalSummary[]) || [])
    setModalLoading(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          Expense Report
        </h1>
        <p className="text-sm text-slate-400 mt-1">Form 17 — Actual-Spent Analytics & Full Audit Trail</p>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Budget Allocated', value: totalAllocated, icon: DollarSign, color: 'blue' },
          { label: 'Actual Spent', value: totalSpent, icon: TrendingDown, color: 'amber' },
          { label: 'Spare Change', value: totalSpareChange, icon: TrendingUp, color: 'emerald' },
          { label: 'Variance', value: totalVariance, icon: BarChart3, color: totalVariance >= 0 ? 'emerald' : 'red' },
        ].map(metric => (
          <div
            key={metric.label}
            className={`bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-1`}
          >
            <div className="flex items-center gap-2">
              <metric.icon className={`w-4 h-4 text-${metric.color}-400`} />
              <span className="text-xs text-slate-400">{metric.label}</span>
            </div>
            <span className={`text-lg font-bold text-${metric.color}-400`}>
              ₱{metric.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Department</label>
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">All Departments</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.department_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Status</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">All Statuses</option>
              {['PENDING_MANAGER','IN_CANVASSING','PENDING_OWNER','APPROVED_READY_TO_ORDER','PURCHASING','FULFILLED','CLOSED','VOIDED','EMERGENCY_FAST_TRACK'].map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <span className="text-xs text-slate-500 ml-auto">{sorted.length} record(s)</span>
        </div>
      </div>

      {/* Data Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500 text-left">
                <th className="py-2 px-3">MRS #</th>
                <th className="py-2 px-3">JO #</th>
                <th className="py-2 px-3">Requester</th>
                <th className="py-2 px-3">Dept</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3 cursor-pointer select-none" onClick={() => handleSort('allocated_budget')}>
                  <span className="flex items-center gap-1">Allocated <SortIcon field="allocated_budget" sortField={sortField} sortAsc={sortAsc} /></span>
                </th>
                <th className="py-2 px-3 cursor-pointer select-none" onClick={() => handleSort('total_actual_spent')}>
                  <span className="flex items-center gap-1">Spent <SortIcon field="total_actual_spent" sortField={sortField} sortAsc={sortAsc} /></span>
                </th>
                <th className="py-2 px-3">Spare</th>
                <th className="py-2 px-3 cursor-pointer select-none" onClick={() => handleSort('created_at')}>
                  <span className="flex items-center gap-1">Date <SortIcon field="created_at" sortField={sortField} sortAsc={sortAsc} /></span>
                </th>
                <th className="py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(m => {
                const variance = Number(m.allocated_budget) - Number(m.total_actual_spent)
                return (
                  <tr key={m.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-200">{m.mrs_number}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-400">{m.jo_number || '—'}</td>
                    <td className="py-2.5 px-3 text-slate-300">{m.requester_name}</td>
                    <td className="py-2.5 px-3 text-slate-400">{m.department_name}</td>
                    <td className="py-2.5 px-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                        m.overall_status === 'CLOSED' ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800/50' :
                        m.overall_status === 'VOIDED' ? 'bg-red-900/30 text-red-400 border-red-800/50' :
                        m.overall_status === 'FULFILLED' ? 'bg-blue-900/30 text-blue-400 border-blue-800/50' :
                        'bg-amber-900/30 text-amber-400 border-amber-800/50'
                      }`}>
                        {m.overall_status?.replace(/_/g, ' ') ?? 'UNKNOWN'}
                      </span>
                      {m.is_emergency_fast_track && (
                        <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800/50">
                          FAST-TRACK
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">₱{Number(m.allocated_budget).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-slate-300">₱{Number(m.total_actual_spent).toLocaleString()}</td>
                    <td className="py-2.5 px-3">
                      <span className={variance >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        ₱{Number(m.spare_change_amount).toLocaleString()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-500">
                      {m.created_at ? new Date(m.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      <button
                        onClick={() => openDeepLink(m)}
                        className="p-1.5 rounded-lg text-indigo-400 hover:bg-indigo-900/30 transition-colors"
                        title="View full audit trail"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500">No records match your filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* DeepLinkModal (Plan.md §5 Form 17) */}
      {selectedMrs && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-5">
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white font-mono">{selectedMrs.mrs_number}</h2>
                <p className="text-xs text-slate-400">{selectedMrs.purpose}</p>
              </div>
              <button
                onClick={() => setSelectedMrs(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* MRS Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-800/50 rounded-lg p-3">
                <span className="text-slate-500">Requester</span>
                <div className="text-slate-200 font-medium mt-0.5">{selectedMrs.requester_name}</div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-3">
                <span className="text-slate-500">Department</span>
                <div className="text-slate-200 font-medium mt-0.5">{selectedMrs.department_name}</div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-3">
                <span className="text-slate-500">JO Link</span>
                <div className="text-slate-200 font-medium mt-0.5 font-mono">{selectedMrs.jo_number || '—'}</div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-3">
                <span className="text-slate-500">Status</span>
                <div className="text-slate-200 font-medium mt-0.5">{selectedMrs.overall_status?.replace(/_/g, ' ') ?? '—'}</div>
              </div>
            </div>

            {/* Financial Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-blue-900/20 border border-blue-800/40 rounded-lg p-3">
                <span className="text-blue-400">Allocated</span>
                <div className="text-blue-300 font-bold text-sm mt-0.5">₱{Number(selectedMrs.allocated_budget).toLocaleString()}</div>
              </div>
              <div className="bg-amber-900/20 border border-amber-800/40 rounded-lg p-3">
                <span className="text-amber-400">Spent</span>
                <div className="text-amber-300 font-bold text-sm mt-0.5">₱{Number(selectedMrs.total_actual_spent).toLocaleString()}</div>
              </div>
              <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-lg p-3">
                <span className="text-emerald-400">Spare Change</span>
                <div className="text-emerald-300 font-bold text-sm mt-0.5">₱{Number(selectedMrs.spare_change_amount).toLocaleString()}</div>
              </div>
              <div className={`rounded-lg p-3 border ${Number(selectedMrs.budget_variance_amount) >= 0 ? 'bg-emerald-900/20 border-emerald-800/40' : 'bg-red-900/20 border-red-800/40'}`}>
                <span className={Number(selectedMrs.budget_variance_amount) >= 0 ? 'text-emerald-400' : 'text-red-400'}>Variance</span>
                <div className={`font-bold text-sm mt-0.5 ${Number(selectedMrs.budget_variance_amount) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  ₱{Number(selectedMrs.budget_variance_amount).toLocaleString()}
                </div>
              </div>
            </div>

            {modalLoading ? (
              <div className="flex items-center justify-center py-8 text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading details…
              </div>
            ) : (
              <>
                {/* Line Items */}
                <div>
                  <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                    <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
                    Line Items ({modalItems.length})
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-700 text-slate-500 text-left">
                          <th className="py-1.5 px-2">Item</th>
                          <th className="py-1.5 px-2">Qty Req</th>
                          <th className="py-1.5 px-2">Qty Ful</th>
                          <th className="py-1.5 px-2">Est ₱</th>
                          <th className="py-1.5 px-2">Actual ₱</th>
                          <th className="py-1.5 px-2">Store</th>
                          <th className="py-1.5 px-2">Rating</th>
                          <th className="py-1.5 px-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modalItems.map(item => (
                          <tr key={item.id} className="border-b border-slate-800/50">
                            <td className="py-1.5 px-2 text-slate-200">{item.item_description}</td>
                            <td className="py-1.5 px-2 text-slate-400">{item.qty_requested} {item.unit}</td>
                            <td className="py-1.5 px-2 text-slate-300">{item.qty_fulfilled}</td>
                            <td className="py-1.5 px-2 text-slate-400">₱{Number(item.est_unit_price).toFixed(2)}</td>
                            <td className="py-1.5 px-2 text-slate-300">₱{Number(item.actual_unit_price).toFixed(2)}</td>
                            <td className="py-1.5 px-2 text-slate-400">
                              {item.store_name || '—'}
                              {item.is_overpriced && <span className="ml-1 text-amber-400">⚠️</span>}
                            </td>
                            <td className="py-1.5 px-2 text-amber-400">{'★'.repeat(item.vendor_rating)}</td>
                            <td className="py-1.5 px-2">
                              <span className="text-[10px] font-semibold">{item.item_delivery_status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Transmittal Chain */}
                <div>
                  <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                    <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
                    Transmittal Chain ({modalTransmittals.length})
                  </h3>
                  {modalTransmittals.length === 0 ? (
                    <p className="text-xs text-slate-500">No transmittals linked.</p>
                  ) : (
                    <div className="space-y-2">
                      {modalTransmittals.map(tr => (
                        <div key={tr.id} className="bg-slate-800/40 rounded-lg p-3 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-mono text-slate-200 font-semibold">{tr.transmittal_number}</span>
                            <span className="ml-2 text-slate-500">{tr.transmittal_type.replace(/_/g, ' ')}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-emerald-400 font-bold">₱{Number(tr.amount).toLocaleString()}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              tr.receiver_status === 'RECEIVED' ? 'bg-emerald-900/30 text-emerald-400' :
                              tr.sender_status === 'SENT' ? 'bg-blue-900/30 text-blue-400' :
                              'bg-amber-900/30 text-amber-400'
                            }`}>
                              {tr.receiver_status === 'RECEIVED' ? 'COMPLETED' : tr.sender_status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
