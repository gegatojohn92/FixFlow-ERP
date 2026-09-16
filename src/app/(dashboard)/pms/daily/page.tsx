'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Wrench,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
  X,
  PlayCircle,
  Calendar,
  MapPin,
  PlusCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { executePMSChecklist } from '@/lib/actions/pms-actions'

type ChecklistValue = 'Passed' | 'Adjusted' | 'Needs Replacement'

// Standard checklist tasks per asset category
const CHECKLIST_TASKS: Record<string, string[]> = {
  HVAC: [
    'Check air filters',
    'Inspect ductwork for leaks',
    'Verify thermostat calibration',
    'Check refrigerant levels',
    'Inspect condenser coils',
    'Test airflow and pressure',
  ],
  ELECTRICAL: [
    'Inspect circuit breakers',
    'Check wiring insulation',
    'Test emergency lighting',
    'Verify grounding connections',
    'Check panel board condition',
  ],
  PLUMBING: [
    'Inspect water pressure',
    'Check for leaks in pipes/valves',
    'Test water heater',
    'Inspect drains for blockage',
    'Check pump operation',
  ],
  KITCHEN_EQUIPMENT: [
    'Clean grease traps',
    'Inspect gas connections',
    'Test safety shut-off valves',
    'Check exhaust fan operation',
    'Inspect refrigeration seals',
  ],
  STRUCTURAL: [
    'Inspect walls and ceilings for cracks',
    'Check floor condition',
    'Inspect roofing/drainage',
    'Check door/window seals',
    'Verify fire exits are clear',
  ],
  GENERAL: [
    'Inspect equipment condition',
    'Check lubrication points',
    'Test operational functionality',
    'Verify safety features',
    'Document any abnormalities',
  ],
}

interface PMSAsset {
  id: number
  asset_name: string
  category: string
  location: string
  interval_type: string
  interval_custom_months: number | null
  last_performed_date: string | null
  next_due_date: string
  is_aircon: boolean
}

function getDaysOverdue(nextDue: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(nextDue)
  return Math.floor((today.getTime() - due.getTime()) / 86400000)
}

export default function PMSDailyPage() {
  const [assets, setAssets] = useState<PMSAsset[]>([])
  const [filter, setFilter] = useState<'due' | 'all'>('due')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Checklist Modal
  const [showModal, setShowModal] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<PMSAsset | null>(null)
  const [checklist, setChecklist] = useState<Record<string, ChecklistValue>>({})

  const supabase = createClient()

  const loadAssets = useCallback(async () => {
    setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      let query = supabase
        .from('pms_assets')
        .select('*')
        .eq('is_aircon', false)

      if (filter === 'due') {
        query = query.lte('next_due_date', today)
      }

      const { data, error: fetchErr } = await query.order('next_due_date', { ascending: true })

      if (fetchErr) throw fetchErr
      setAssets((data as PMSAsset[]) || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load PMS queue.')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  const openChecklistModal = (asset: PMSAsset) => {
    setSelectedAsset(asset)
    const tasks = CHECKLIST_TASKS[asset.category] || CHECKLIST_TASKS.GENERAL
    const initialChecklist: Record<string, ChecklistValue> = {}
    tasks.forEach((t) => { initialChecklist[t] = 'Passed' })
    setChecklist(initialChecklist)
    setShowModal(true)
  }

  const handleSaveComplete = async () => {
    if (!selectedAsset) return
    setActionLoading(true)
    setError(null)
    try {
      const result = await executePMSChecklist({
        assetId: selectedAsset.id,
        checklistJson: checklist,
      })
      setShowModal(false)
      setSelectedAsset(null)
      setActionMessage(
        `✅ ${selectedAsset.asset_name} serviced. Next due: ${result.nextDueDate}`
      )
      await loadAssets()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save checklist.')
    } finally {
      setActionLoading(false)
    }
  }

  const needsAttentionCount = assets.filter(
    (a) => getDaysOverdue(a.next_due_date) >= 0
  ).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/pms"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                Equipment & Facility PMS
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-950 text-emerald-400 border border-emerald-900">
                FORM 15
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Assets due for service today. Execute checklist to reset next due date.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/pms/register"
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 transition-all"
          >
            <PlusCircle className="w-4 h-4" />
            Register Asset
          </Link>
          {needsAttentionCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-950/40 border border-amber-800/60 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-amber-300 font-semibold">
                {needsAttentionCount} asset{needsAttentionCount !== 1 ? 's' : ''} due
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => setFilter('due')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            filter === 'due'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white bg-slate-900/60'
          }`}
        >
          Due for Service
        </button>
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            filter === 'all'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white bg-slate-900/60'
          }`}
        >
          All Equipment
        </button>
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
          <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
          <span>Loading PMS queue...</span>
        </div>
      ) : assets.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/60 border border-slate-800 rounded-2xl space-y-4">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <div>
            <p className="text-sm text-slate-300 font-semibold">
              {filter === 'due' ? 'All equipment up to date!' : 'No equipment registered yet.'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {filter === 'due'
                ? 'No equipment is currently overdue for servicing. Switch to "All Equipment" to inspect all registered assets.'
                : 'Register equipment assets to track preventive maintenance schedules.'}
            </p>
          </div>
          <Link
            href="/pms/register"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
          >
            <PlusCircle className="w-4 h-4" /> Register New Asset
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {assets.map((asset) => {
            const daysOverdue = getDaysOverdue(asset.next_due_date)
            const overdueBadgeClass = daysOverdue > 7
              ? 'text-rose-300 border-rose-800 bg-rose-950/60'
              : daysOverdue > 0
              ? 'text-amber-300 border-amber-800 bg-amber-950/60'
              : 'text-emerald-300 border-emerald-800 bg-emerald-950/40'

            return (
              <div
                key={asset.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-900/80 border border-slate-800 rounded-2xl"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600/15 border border-emerald-700/30 flex items-center justify-center shrink-0">
                    <Wrench className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white">{asset.asset_name}</span>
                      <span className="text-[10px] font-semibold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                        {asset.category}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />{asset.location}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Due: <b className="text-slate-300">{asset.next_due_date}</b>
                      </span>
                      {asset.last_performed_date && (
                        <span className="flex items-center gap-1 text-slate-500">
                          <Clock className="w-3 h-3" />
                          Last: {asset.last_performed_date}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:shrink-0">
                  <span className={`text-[10px] font-bold border px-2 py-0.5 rounded-lg ${overdueBadgeClass}`}>
                    {daysOverdue > 0 ? `${daysOverdue}d overdue` : 'Due today'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openChecklistModal(asset)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors shadow-md shadow-emerald-600/20"
                  >
                    <PlayCircle className="w-3.5 h-3.5" />
                    Execute Checklist
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Checklist Modal */}
      {showModal && selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <PlayCircle className="w-4 h-4 text-emerald-400" />
                  PMS Checklist: {selectedAsset.asset_name}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {selectedAsset.category} · {selectedAsset.location}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Checklist Items */}
            <div className="p-5 space-y-3 max-h-[55vh] overflow-y-auto">
              {Object.keys(checklist).map((task) => (
                <div key={task} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-200 flex-1">{task}</span>
                  <select
                    value={checklist[task]}
                    onChange={(e) => setChecklist((prev) => ({
                      ...prev,
                      [task]: e.target.value as ChecklistValue,
                    }))}
                    className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border focus:outline-none focus:ring-1 bg-slate-950 ${
                      checklist[task] === 'Passed'
                        ? 'text-emerald-300 border-emerald-800/60 focus:ring-emerald-500'
                        : checklist[task] === 'Adjusted'
                        ? 'text-amber-300 border-amber-800/60 focus:ring-amber-500'
                        : 'text-rose-300 border-rose-800/60 focus:ring-rose-500'
                    }`}
                  >
                    <option value="Passed">Passed</option>
                    <option value="Adjusted">Adjusted</option>
                    <option value="Needs Replacement">Needs Replacement</option>
                  </select>
                </div>
              ))}
            </div>

            {/* Summary bar */}
            <div className="px-5 pb-2 flex items-center gap-3 text-[10px] font-semibold">
              <span className="text-emerald-400">
                ✓ {Object.values(checklist).filter((v) => v === 'Passed').length} Passed
              </span>
              <span className="text-amber-400">
                ↺ {Object.values(checklist).filter((v) => v === 'Adjusted').length} Adjusted
              </span>
              <span className="text-rose-400">
                ✕ {Object.values(checklist).filter((v) => v === 'Needs Replacement').length} Need Replacement
              </span>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleSaveComplete}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save & Complete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
