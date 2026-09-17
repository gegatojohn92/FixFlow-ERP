'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Wind,
  PlusCircle,
  Calendar,
  MapPin,
  Tag,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { registerPMSAsset } from '@/lib/actions/pms-actions'

const CATEGORIES = [
  { value: 'HVAC', label: 'HVAC (Heating, Vent, AC)' },
  { value: 'ELECTRICAL', label: 'Electrical & Power' },
  { value: 'PLUMBING', label: 'Plumbing & Water Systems' },
  { value: 'STRUCTURAL', label: 'Structural & Architectural' },
  { value: 'KITCHEN_EQUIPMENT', label: 'Kitchen & Dining Equipment' },
  { value: 'GENERAL', label: 'General Facility Asset' },
] as const

const INTERVALS = [
  { value: 'DAILY', label: 'Daily Service' },
  { value: 'WEEKLY', label: 'Weekly Service' },
  { value: 'MONTHLY', label: 'Monthly Service' },
  { value: 'CUSTOM_MONTHS', label: 'Custom Months Interval' },
  { value: 'YEARLY', label: 'Annual / Yearly Service' },
] as const

export default function RegisterPMSAssetPage() {
  const router = useRouter()
  const today = new Date().toISOString().split('T')[0]

  const [assetName, setAssetName] = useState('')
  const [isAircon, setIsAircon] = useState(false)
  const [category, setCategory] = useState<'HVAC' | 'ELECTRICAL' | 'PLUMBING' | 'STRUCTURAL' | 'KITCHEN_EQUIPMENT' | 'GENERAL'>('GENERAL')
  const [location, setLocation] = useState('')
  const [intervalType, setIntervalType] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM_MONTHS' | 'YEARLY'>('MONTHLY')
  const [intervalMonths, setIntervalMonths] = useState<number>(3)
  const [nextDueDate, setNextDueDate] = useState(today)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // When isAircon toggled ON, auto configure to HVAC & 3-month cycle
  const handleAirconToggle = (checked: boolean) => {
    setIsAircon(checked)
    if (checked) {
      setCategory('HVAC')
      setIntervalType('CUSTOM_MONTHS')
      setIntervalMonths(3)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      if (!assetName.trim()) {
        throw new Error('Please enter the asset or equipment name.')
      }
      if (!location.trim()) {
        throw new Error('Please enter the physical location of the asset.')
      }
      if (!nextDueDate) {
        throw new Error('Please specify the initial next due date.')
      }

      await registerPMSAsset({
        asset_name: assetName.trim(),
        category,
        location: location.trim(),
        interval_type: intervalType,
        interval_custom_months: intervalType === 'CUSTOM_MONTHS' ? Number(intervalMonths) : null,
        next_due_date: nextDueDate,
        is_aircon: isAircon,
      })

      setSuccess(true)
      setTimeout(() => {
        if (isAircon) {
          router.push('/pms/aircon')
        } else {
          router.push('/pms/daily')
        }
      }, 1500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to register PMS asset.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      {/* Header & Back Link */}
      <div className="flex items-center justify-between">
        <Link
          href="/pms"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to PMS
        </Link>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/80">
          Asset Registration
        </span>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
            <PlusCircle className="w-6 h-6 text-emerald-400" />
            Register PMS Asset
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Add equipment or facility assets to the preventive maintenance schedule and automated tracking cycles.
          </p>
        </div>

        {/* Aircon Switch Card */}
        <div
          onClick={() => handleAirconToggle(!isAircon)}
          className={`cursor-pointer border rounded-xl p-4 transition-all flex items-center justify-between ${
            isAircon
              ? 'bg-blue-950/40 border-blue-600/60 shadow-lg shadow-blue-950/30'
              : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-lg mt-0.5 ${
                isAircon ? 'bg-blue-600/20 text-blue-400 border border-blue-600/40' : 'bg-slate-800 text-slate-400'
              }`}
            >
              <Wind className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">Air Conditioning Unit</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-900/60 text-blue-300 border border-blue-800">
                  Form 16
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                Enable for AC split, cassette, or package units requiring 3-month freon, compressor amperage, and service photos.
              </p>
            </div>
          </div>

          <div
            className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
              isAircon ? 'bg-blue-600' : 'bg-slate-700'
            }`}
          >
            <div
              className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                isAircon ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </div>
        </div>

        {/* Feedback Alerts */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>Asset successfully registered! Redirecting to the PMS queue...</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Asset Name */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
              Asset / Equipment Name <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                required
                value={assetName}
                onChange={(e) => setAssetName(e.target.value)}
                placeholder={isAircon ? 'e.g. 2.0HP Split AC - Room 204' : 'e.g. Main Kitchen Cold Storage #1'}
                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors"
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-400" /> Location / Floor / Room <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. 2nd Floor Executive Suite, Server Room, Kitchen Area"
              className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors"
            />
          </div>

          {/* Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-emerald-400" /> Category <span className="text-rose-400">*</span>
              </label>
              <select
                value={category}
                disabled={isAircon}
                onChange={(e) => setCategory(e.target.value as 'HVAC' | 'ELECTRICAL' | 'PLUMBING' | 'STRUCTURAL' | 'KITCHEN_EQUIPMENT' | 'GENERAL')}
                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              {isAircon && (
                <p className="text-[11px] text-blue-400 mt-1">Locked to HVAC for aircon assets</p>
              )}
            </div>

            {/* Interval Type */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-400" /> Service Frequency <span className="text-rose-400">*</span>
              </label>
              <select
                value={intervalType}
                disabled={isAircon}
                onChange={(e) => setIntervalType(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM_MONTHS' | 'YEARLY')}
                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {INTERVALS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
              {isAircon && (
                <p className="text-[11px] text-blue-400 mt-1">Form 16 uses standard 3-Month Cycle</p>
              )}
            </div>
          </div>

          {/* Custom Months input if CUSTOM_MONTHS selected and not aircon */}
          {intervalType === 'CUSTOM_MONTHS' && !isAircon && (
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                Interval Duration (in Months)
              </label>
              <input
                type="number"
                min="1"
                max="60"
                value={intervalMonths}
                onChange={(e) => setIntervalMonths(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none transition-colors"
              />
              <p className="text-[11px] text-slate-400 mt-1">Next due date will advance by this number of months after each checklist execution.</p>
            </div>
          )}

          {/* Initial Next Due Date */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-emerald-400" /> Initial Due Date <span className="text-rose-400">*</span>
            </label>
            <input
              type="date"
              required
              value={nextDueDate}
              onChange={(e) => setNextDueDate(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none transition-colors [color-scheme:dark]"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Set to today ({today}) to make the asset immediately available in the queue for initial servicing.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 flex flex-col sm:flex-row items-center gap-3">
            <button
              type="submit"
              disabled={submitting || success}
              className={`w-full sm:flex-1 py-3 px-5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-all ${
                isAircon
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Registering Asset...
                </>
              ) : (
                <>
                  <PlusCircle className="w-4 h-4" /> Save & Register Asset
                </>
              )}
            </button>

            <Link
              href="/pms"
              className="w-full sm:w-auto px-5 py-3 rounded-xl font-semibold text-sm text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 transition-colors text-center"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
