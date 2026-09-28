'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Wind,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  PlayCircle,
  Calendar,
  MapPin,
  Thermometer,
  Zap,
  Camera,
  PlusCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { executeAirconService } from '@/lib/actions/pms-actions'

type ChecklistValue = 'Passed' | 'Adjusted' | 'Needs Replacement'

const AIRCON_CHECKLIST_TASKS = [
  'Clean air filters',
  'Clean evaporator coil',
  'Clean condenser coil',
  'Check refrigerant lines for leaks',
  'Inspect electrical connections',
  'Test thermostat accuracy',
  'Check condensate drain',
  'Verify airflow (CFM)',
  'Inspect fan blades and motor',
  'Test start capacitors',
  'Check for unusual noise/vibration',
  'Verify unit cycles on/off properly',
]

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

interface ServiceData {
  checklist: Record<string, ChecklistValue>
  freonPressurePsi: string
  compressorAmperage: string
  photoUrl: string
}

function getDaysOverdue(nextDue: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(nextDue)
  return Math.floor((today.getTime() - due.getTime()) / 86400000)
}

export default function AirconPMSPage() {
  const [assets, setAssets] = useState<PMSAsset[]>([])
  const [filter, setFilter] = useState<'due' | 'all'>('due')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<PMSAsset | null>(null)
  const [serviceData, setServiceData] = useState<ServiceData>({
    checklist: {},
    freonPressurePsi: '',
    compressorAmperage: '',
    photoUrl: '',
  })

  const supabase = createClient()

  const loadAssets = useCallback(async () => {
    setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      let query = supabase
        .from('pms_assets')
        .select('*')
        .eq('is_aircon', true)

      if (filter === 'due') {
        query = query.lte('next_due_date', today)
      }

      const { data, error: fetchErr } = await query.order('next_due_date', { ascending: true })

      if (fetchErr) throw fetchErr
      setAssets((data as PMSAsset[]) || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load aircon queue.')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAssets()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadAssets])

  const openServiceModal = (asset: PMSAsset) => {
    setSelectedAsset(asset)
    const initialChecklist: Record<string, ChecklistValue> = {}
    AIRCON_CHECKLIST_TASKS.forEach((t) => { initialChecklist[t] = 'Passed' })
    setServiceData({
      checklist: initialChecklist,
      freonPressurePsi: '',
      compressorAmperage: '',
      photoUrl: '',
    })
    setShowModal(true)
  }

  const updateChecklist = (task: string, val: ChecklistValue) => {
    setServiceData((prev) => ({
      ...prev,
      checklist: { ...prev.checklist, [task]: val },
    }))
  }

  const handleSaveComplete = async () => {
    if (!selectedAsset) return
    setActionLoading(true)
    setError(null)
    try {
      const result = await executeAirconService({
        assetId: selectedAsset.id,
        checklistJson: serviceData.checklist,
        freonPressurePsi: serviceData.freonPressurePsi
          ? parseFloat(serviceData.freonPressurePsi)
          : undefined,
        compressorAmperage: serviceData.compressorAmperage
          ? parseFloat(serviceData.compressorAmperage)
          : undefined,
        photoUrl: serviceData.photoUrl || undefined,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      setShowModal(false)
      setSelectedAsset(null)
      setActionMessage(
        `✅ ${selectedAsset.asset_name} serviced. Next 3-month service: ${result.nextDueDate}`
      )
      await loadAssets()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save service record.')
    } finally {
      setActionLoading(false)
    }
  }

  const dueCount = assets.length
  const passedCount = Object.values(serviceData.checklist).filter((v) => v === 'Passed').length
  const needsReplacement = Object.values(serviceData.checklist).filter((v) => v === 'Needs Replacement').length

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
                Aircon 3-Month Service
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-950 text-blue-400 border border-blue-900">
                FORM 16
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Freon pressure, compressor amperage, and full unit service log.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/pms/register"
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/20 transition-all"
          >
            <PlusCircle className="w-4 h-4" />
            Register Aircon
          </Link>
          {dueCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-950/40 border border-blue-800/60 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-blue-300 font-semibold">
                {dueCount} due
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
              ? 'bg-blue-600 text-white shadow-md'
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
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white bg-slate-900/60'
          }`}
        >
          All Aircon Units
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
          <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
          <span>Loading aircon service queue...</span>
        </div>
      ) : assets.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/60 border border-slate-800 rounded-2xl space-y-4">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <div>
            <p className="text-sm text-slate-300 font-semibold">
              {filter === 'due' ? 'All aircon units are up to date!' : 'No aircon units registered yet.'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {filter === 'due'
                ? 'No units are currently overdue for 3-month service. Switch to "All Aircon Units" to see registered units.'
                : 'Register air conditioning units to track 3-month maintenance schedules, freon PSI, and compressor amperage.'}
            </p>
          </div>
          <Link
            href="/pms/register"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors"
          >
            <PlusCircle className="w-4 h-4" /> Register Aircon Unit
          </Link>
        </div>
      ) : (
        /* Aircon Unit Cards — Grid layout */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {assets.map((asset) => {
            const daysOverdue = getDaysOverdue(asset.next_due_date)
            const overdueBadgeClass = daysOverdue > 14
              ? 'text-rose-300 border-rose-800 bg-rose-950/60'
              : daysOverdue > 0
              ? 'text-amber-300 border-amber-800 bg-amber-950/60'
              : 'text-blue-300 border-blue-800 bg-blue-950/40'

            return (
              <div
                key={asset.id}
                className="flex flex-col gap-4 p-5 bg-slate-900/80 border border-slate-800 rounded-2xl hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-700/40 flex items-center justify-center shrink-0">
                    <Wind className="w-5 h-5 text-blue-400" />
                  </div>
                  <span className={`text-[10px] font-bold border px-2 py-0.5 rounded-lg ${overdueBadgeClass}`}>
                    {daysOverdue > 0 ? `${daysOverdue}d overdue` : 'Due today'}
                  </span>
                </div>

                <div className="space-y-1">
                      <Link href={`/audit-logs/pms_asset/${asset.id}`} className="text-sm font-bold text-white hover:text-cyan-300" title="View audit history">{asset.asset_name}</Link>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />{asset.location}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Due: <b className="text-slate-300">{asset.next_due_date}</b>
                    </span>
                  </div>
                  {asset.last_performed_date && (
                    <p className="text-[10px] text-slate-500 font-mono">
                      Last service: {asset.last_performed_date}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => openServiceModal(asset)}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors shadow-md shadow-blue-600/20"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  Start Service
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Aircon Service Modal */}
      {showModal && selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800 shrink-0">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Wind className="w-4 h-4 text-blue-400" />
                  Aircon Service: {selectedAsset.asset_name}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {selectedAsset.location} · 3-month cycle
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

            {/* Body */}
            <div className="overflow-y-auto flex-1">
              {/* Readings Row */}
              <div className="p-5 border-b border-slate-800/60 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Thermometer className="w-3.5 h-3.5 text-cyan-400" />
                    Freon Pressure (PSI):
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={serviceData.freonPressurePsi}
                    onChange={(e) => setServiceData((p) => ({ ...p, freonPressurePsi: e.target.value }))}
                    placeholder="e.g. 200.0"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Zap className="w-3.5 h-3.5 text-yellow-400" />
                    Compressor Amperage (A):
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={serviceData.compressorAmperage}
                    onChange={(e) => setServiceData((p) => ({ ...p, compressorAmperage: e.target.value }))}
                    placeholder="e.g. 8.5"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Camera className="w-3.5 h-3.5 text-blue-400" />
                    Photo URL (optional):
                  </label>
                  <input
                    type="url"
                    value={serviceData.photoUrl}
                    onChange={(e) => setServiceData((p) => ({ ...p, photoUrl: e.target.value }))}
                    placeholder="https://..."
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Checklist */}
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {AIRCON_CHECKLIST_TASKS.map((task) => (
                  <div key={task} className="flex items-center justify-between gap-3 p-2.5 bg-slate-950/60 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-200 flex-1 leading-snug">{task}</span>
                    <select
                      value={serviceData.checklist[task] || 'Passed'}
                      onChange={(e) => updateChecklist(task, e.target.value as ChecklistValue)}
                      className={`text-[11px] font-semibold px-2 py-1 rounded-lg border focus:outline-none focus:ring-1 bg-slate-900 shrink-0 ${
                        serviceData.checklist[task] === 'Passed'
                          ? 'text-emerald-300 border-emerald-800/60'
                          : serviceData.checklist[task] === 'Adjusted'
                          ? 'text-amber-300 border-amber-800/60'
                          : 'text-rose-300 border-rose-800/60'
                      }`}
                    >
                      <option value="Passed">Passed</option>
                      <option value="Adjusted">Adjusted</option>
                      <option value="Needs Replacement">Needs Replacement</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Summary + Footer */}
            <div className="p-5 border-t border-slate-800 space-y-3 shrink-0">
              <div className="flex items-center gap-4 text-[11px] font-semibold">
                <span className="text-emerald-400">✓ {passedCount} Passed</span>
                <span className="text-amber-400">
                  ↺ {Object.values(serviceData.checklist).filter((v) => v === 'Adjusted').length} Adjusted
                </span>
                <span className="text-rose-400">✕ {needsReplacement} Need Replacement</span>
              </div>
              <div className="flex items-center justify-end gap-2">
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
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Complete Service
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
