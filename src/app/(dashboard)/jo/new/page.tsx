'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Wrench,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Loader2,
  MapPin,
  ArrowLeft,
} from 'lucide-react'
import Link from 'next/link'
import { CameraCapture, type AttachmentRecord } from '@/components/hardware/CameraCapture'
import { createJobOrder } from '@/lib/actions/jo-actions'
import type { JOPriority } from '@/types/index'
import { formatToday } from '@/lib/format-date'

const COMMON_LOCATIONS = [
  'Guest Room',
  'Main Lobby',
  'Restaurant / Bar',
  'Commercial Kitchen',
  'Swimming Pool Area',
  'Laundry Facilities',
  'Staff Quarters',
  'HVAC & Utility Plant',
  'Parking & Exterior Grounds',
  'Other / Custom',
]

export default function NewJobOrderPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [locationType, setLocationType] = useState(COMMON_LOCATIONS[0])
  const [customLocation, setCustomLocation] = useState('')
  const [priority, setPriority] = useState<JOPriority>('NORMAL')
  const [description, setDescription] = useState('')
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finalLocation = locationType === 'Other / Custom'
    ? customLocation.trim()
    : customLocation.trim() ? `${locationType} - ${customLocation.trim()}` : locationType

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !description.trim() || !finalLocation) {
      setError('Please fill in all required fields (title, location, and description).')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const photoUrls = attachments.map((a) => a.file_url)

      const result = await createJobOrder({
        title,
        location: finalLocation,
        description,
        priority,
        photoUrls,
      })

      if (result.success && result.jo) {
        router.push(`/jo/track?id=${result.jo.id}`)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit Job Order.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const currentDate = formatToday()

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Navigation & Header */}
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
              Create Job Order
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-950 text-blue-400 border border-blue-900">
              FORM 1
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Submit a maintenance or repair ticket for technician assessment.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-950/50 border border-red-800 rounded-xl text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Form Card */}
      <form onSubmit={handleSubmit} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-7 space-y-6 shadow-xl">
        {/* Read-only reference banner */}
        <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl text-xs">
          <div>
            <span className="text-slate-400 block text-[11px]">Reference Number:</span>
            <span className="font-mono font-bold text-blue-400">
              Auto-generated (JO-2026-XXXXXX)
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px]">Submission Date:</span>
            <span className="font-semibold text-slate-200">{currentDate}</span>
          </div>
        </div>

        {/* Issue Title */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-slate-200">
            Issue Title / Summary <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Master Bedroom AC Leaking Water / Kitchen Exhaust Fan Malfunction"
            className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Location Selector */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-slate-200">
            Specific Location <span className="text-rose-400">*</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              value={locationType}
              onChange={(e) => setLocationType(e.target.value)}
              className="px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {COMMON_LOCATIONS.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                <MapPin className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                placeholder="Specific room #, floor, or notes..."
                className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Priority 3-tier Selection Radio */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-slate-200">
              Priority Level <span className="text-rose-400">*</span>
            </label>
            <span className="text-[11px] text-slate-400">
              EMERGENCY unlocks Fast-Track procurement
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {/* Normal */}
            <label
              className={`flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all text-center ${
                priority === 'NORMAL'
                  ? 'border-blue-500 bg-blue-950/40 text-white shadow-md'
                  : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <input
                type="radio"
                name="priority"
                value="NORMAL"
                checked={priority === 'NORMAL'}
                onChange={() => setPriority('NORMAL')}
                className="sr-only"
              />
              <Wrench className={`w-4 h-4 mb-1 ${priority === 'NORMAL' ? 'text-blue-400' : 'text-slate-500'}`} />
              <span className="text-xs font-bold">NORMAL</span>
              <span className="text-[10px] opacity-75 mt-0.5">Standard repair queue</span>
            </label>

            {/* Urgent */}
            <label
              className={`flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all text-center ${
                priority === 'URGENT'
                  ? 'border-amber-500 bg-amber-950/40 text-amber-200 shadow-md'
                  : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <input
                type="radio"
                name="priority"
                value="URGENT"
                checked={priority === 'URGENT'}
                onChange={() => setPriority('URGENT')}
                className="sr-only"
              />
              <AlertTriangle className={`w-4 h-4 mb-1 ${priority === 'URGENT' ? 'text-amber-400' : 'text-slate-500'}`} />
              <span className="text-xs font-bold">URGENT</span>
              <span className="text-[10px] opacity-75 mt-0.5">Prompt attention</span>
            </label>

            {/* Emergency */}
            <label
              className={`flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all text-center ${
                priority === 'EMERGENCY'
                  ? 'border-rose-500 bg-rose-950/50 text-rose-200 shadow-md ring-1 ring-rose-500'
                  : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <input
                type="radio"
                name="priority"
                value="EMERGENCY"
                checked={priority === 'EMERGENCY'}
                onChange={() => setPriority('EMERGENCY')}
                className="sr-only"
              />
              <Flame className={`w-4 h-4 mb-1 ${priority === 'EMERGENCY' ? 'text-rose-400' : 'text-slate-500'}`} />
              <span className="text-xs font-bold">EMERGENCY</span>
              <span className="text-[10px] opacity-75 mt-0.5">Immediate hazard</span>
            </label>
          </div>
        </div>

        {/* Detailed Description */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-slate-200">
            Problem Description <span className="text-rose-400">*</span>
          </label>
          <textarea
            required
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what is broken, symptoms, noises, leaks, or hazards observed..."
            className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed"
          />
        </div>

        {/* Site Photos Upload via CameraCapture */}
        <div className="pt-2 border-t border-slate-800/80">
          <CameraCapture
            context="JO_SITE_PHOTO"
            entityType="job_order"
            maxFiles={3}
            label="Site Photos (Up to 3 images)"
            helperText="Rear camera or upload"
            existingAttachments={attachments}
            onAttachmentsChange={setAttachments}
            disabled={isSubmitting}
          />
        </div>

        {/* Submit Actions */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
          <Link
            href="/dashboard"
            className="px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors"
          >
            Cancel
          </Link>

          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>{isSubmitting ? 'Submitting...' : 'Submit Job Order'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
