'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ShoppingCart,
  Plus,
  Trash2,
  Globe,
  Zap,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  DollarSign,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { createMRS, type MRSLineItemInput } from '@/lib/actions/mrs-actions'
import { JO_STATUSES_FOR_MRS_LINK } from '@/lib/status-machines'
import { useActionLock } from '@/components/ui/ActionLock'
import CameraCapture from '@/components/shared/CameraCapture'

const UNITS = ['Pcs', 'Boxes', 'Ltrs', 'Cans', 'Meters', 'Kg', 'Packs', 'Rolls', 'Sets']
const FAST_TRACK_ALLOWED_DEPTS = ['kitchen', 'f&b', 'housekeeping', 'maintenance']

function MRSNewForm() {
  const { runLocked } = useActionLock()
  const router = useRouter()
  const searchParams = useSearchParams()
  const joIdParam = searchParams.get('jo_id')

  // User session state
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [departmentName, setDepartmentName] = useState('')
  const [, setUserRole] = useState('')
  const [linkedJO, setLinkedJO] = useState<{ id: number; jo_number: string; title: string; priority: string; status: string } | null>(null)

  // Form inputs
  const [purpose, setPurpose] = useState('')
  const [isOnline, setIsOnline] = useState(false)
  const [onlineUrl, setOnlineUrl] = useState('')
  const [estShipping, setEstShipping] = useState<number>(0)
  const [onlineScreenshotUrl, setOnlineScreenshotUrl] = useState('')
  const [isFastTrack, setIsFastTrack] = useState(false)

  // Catalog items for autocomplete
  const [catalogItems, setCatalogItems] = useState<Array<{ item_description: string; store_name: string; last_unit_price: number; is_overpriced_flag: boolean }>>([])

  // Line items
  const [lineItems, setLineItems] = useState<MRSLineItemInput[]>([
    { item_description: '', qty_requested: 1, unit: 'Pcs', store_name: '', est_unit_price: 0 },
  ])

  // UI status
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successCode, setSuccessCode] = useState<string | null>(null)

  const supabase = createClient()

  // Load user profile & optional linked JO & catalog
  useEffect(() => {
    async function loadData() {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/login')
          return
        }

        const { data: profile } = await supabase
          .from('users')
          .select('id, role, department_id, department:departments(id, department_name)')
          .eq('id', user.id)
          .single()

        if (profile) {
          setUserRole(profile.role)
          setDepartmentId(profile.department_id)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setDepartmentName((profile.department as any)?.department_name ?? '')
        }

        // Check linked JO (status included so we can block ineligible links
        // client-side — the server action enforces the same rule, 0011)
        if (joIdParam) {
          const { data: jo } = await supabase
            .from('job_orders')
            .select('id, jo_number, title, priority, status')
            .eq('id', Number(joIdParam))
            .single()

          if (jo) setLinkedJO(jo)
        }

        // Fetch catalog items for quick autocomplete
        const { data: catalog } = await supabase
          .from('item_price_catalog')
          .select('item_description, store_name, last_unit_price, is_overpriced_flag')
          .limit(100)

        if (catalog) setCatalogItems(catalog)
      } catch (err: unknown) {
        console.error('Error loading metadata:', err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [joIdParam, router, supabase])

  // Line items manipulation
  const addLineItem = () => {
    setLineItems(prev => [
      ...prev,
      { item_description: '', qty_requested: 1, unit: 'Pcs', store_name: '', est_unit_price: 0 },
    ])
  }

  const removeLineItem = (index: number) => {
    if (lineItems.length === 1) return
    setLineItems(prev => prev.filter((_, i) => i !== index))
  }

  const updateLineItem = (index: number, field: keyof MRSLineItemInput, value: unknown) => {
    setLineItems(prev => {
      const copy = [...prev]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
  }

  const handleSelectCatalogItem = (index: number, itemDesc: string) => {
    const match = catalogItems.find(c => c.item_description.toLowerCase() === itemDesc.toLowerCase())
    if (match) {
      updateLineItem(index, 'item_description', match.item_description)
      updateLineItem(index, 'store_name', match.store_name)
      updateLineItem(index, 'est_unit_price', match.last_unit_price)
    } else {
      updateLineItem(index, 'item_description', itemDesc)
    }
  }

  // Cost calculation
  const itemsSubtotal = lineItems.reduce(
    (sum, item) => sum + (Number(item.est_unit_price) || 0) * (Number(item.qty_requested) || 1),
    0
  )
  const totalCost = itemsSubtotal + (isOnline ? Number(estShipping) || 0 : 0)

  // Fast-track eligibility check (Plan.md §6.A)
  const deptEligible = FAST_TRACK_ALLOWED_DEPTS.some(d => departmentName.toLowerCase().includes(d))
  const joEmergency = linkedJO?.priority === 'EMERGENCY'
  const costEligible = totalCost <= 3000.00
  const canUseFastTrack = deptEligible && joEmergency

  // A JO that has moved past the requisition window (COMPLETED, CANCELLED,
  // CLOSED, ...) cannot accept a new MRS — block the form early (0011).
  const joLinkEligible =
    !linkedJO || (JO_STATUSES_FOR_MRS_LINK as readonly string[]).includes(linkedJO.status)

  const handleSubmit = async (e: React.FormEvent) => {

    await runLocked('Submitting requisition…', async () => {
      e.preventDefault()
      if (!departmentId) {
        setError('Department information is missing.')
        return
      }

      if (!joLinkEligible) {
        setError('The linked Job Order can no longer receive requisitions in its current status.')
        return
      }

      if (lineItems.some(item => !item.item_description.trim() || item.qty_requested <= 0)) {
        setError('Please provide valid descriptions and quantities for all line items.')
        return
      }

      setSubmitting(true)
      setError(null)

      try {
        const res = await createMRS({
          request_type: linkedJO ? 'JOB_ORDER' : 'STANDALONE',
          jo_id: linkedJO ? linkedJO.id : null,
          department_id: departmentId,
          purpose,
          is_online_purchase: isOnline,
          online_supplier_url: isOnline ? onlineUrl : undefined,
          est_shipping_fee: isOnline ? estShipping : 0,
          online_screenshot_url: isOnline && onlineScreenshotUrl ? onlineScreenshotUrl : undefined,
          is_emergency_fast_track: isFastTrack && canUseFastTrack && costEligible,
          line_items: lineItems,
        })

        if (res.success && res.mrs) {
          setSuccessCode(res.mrs.mrs_number)
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to create Requisition.')
      } finally {
        setSubmitting(false)
      }

    })

  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mr-3" />
        <span>Loading requisition environment...</span>
      </div>
    )
  }

  if (successCode) {
    return (
      <div className="max-w-xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-6">
        <div className="w-16 h-16 bg-emerald-950/80 border border-emerald-700/60 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-black text-white">Requisition Submitted!</h2>
          <p className="text-sm text-slate-400">
            Reference code has been generated atomically:
          </p>
          <div className="inline-block px-4 py-2 bg-slate-950 border border-slate-700 rounded-xl font-mono text-lg font-bold text-emerald-400">
            {successCode}
          </div>
        </div>
        {isFastTrack ? (
          <div className="p-4 bg-amber-950/40 border border-amber-800 rounded-xl text-xs text-amber-200 text-left">
            <span className="font-bold">EMERGENCY FAST-TRACK ACTIVE:</span> Forms 6, 7, 8, and 10 have been bypassed. You may proceed immediately with the emergency purchase up to ₱3,000.00. Manager/BO post-audit will occur within 24 hours.
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            Forwarded to Storekeeper queue for warehouse stock verification.
          </p>
        )}
        <div className="flex items-center justify-center gap-3 pt-4">
          <button
            onClick={() => router.push('/mrs')}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg transition-colors"
          >
            View Requisitions
          </button>
          <button
            onClick={() => {
              setSuccessCode(null)
              setPurpose('')
              setLineItems([{ item_description: '', qty_requested: 1, unit: 'Pcs', store_name: '', est_unit_price: 0 }])
            }}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors"
          >
            Create Another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-blue-500" />
            <h1 className="text-xl font-black text-white tracking-tight">
              Material Requisition Slip (MRS)
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Form 5 — Request parts, consumables, supplies, or service materials.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400">Department:</span>
          <span className="px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs font-bold text-slate-200">
            {departmentName || 'Loading...'}
          </span>
        </div>
      </div>

      {/* Linked JO Banner if present */}
      {linkedJO && (
        <div className="p-3 bg-blue-950/40 border border-blue-800/80 rounded-xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-blue-200">
            <FileText className="w-4 h-4 text-blue-400" />
            <span>Pre-linked to Job Order:</span>
            <span className="font-mono font-bold text-white">{linkedJO.jo_number}</span>
            <span className="text-slate-400">({linkedJO.title})</span>
          </div>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
            linkedJO.priority === 'EMERGENCY'
              ? 'bg-rose-950 text-rose-300 border border-rose-800'
              : 'bg-slate-800 text-slate-300'
          }`}>
            Priority: {linkedJO.priority}
          </span>
        </div>
      )}

      {/* Ineligible Linked JO Warning (0011) */}
      {linkedJO && !joLinkEligible && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Job Order <b className="font-mono">{linkedJO.jo_number}</b> is{' '}
            <b>{linkedJO.status}</b> and can no longer receive requisitions. Only tickets in{' '}
            {JO_STATUSES_FOR_MRS_LINK.join(', ')} may be linked. Submission is disabled — create a
            standalone requisition or link an active Job Order.
          </span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-950/40 border border-red-800 rounded-xl text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Purpose */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
            Requisition Purpose & Scope *
          </label>
          <textarea
            required
            rows={2}
            maxLength={2000}
            value={purpose}
            onChange={e => setPurpose(e.target.value)}
            placeholder="Explain what materials are needed and why (e.g. replacement capacitors for condenser unit AC-04)..."
            className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Line Items Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Line Items Breakdown</h2>
            <button
              type="button"
              onClick={addLineItem}
              className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Item</span>
            </button>
          </div>

          <div className="space-y-3">
            {lineItems.map((item, idx) => {
              const lineTotal = (Number(item.est_unit_price) || 0) * (Number(item.qty_requested) || 0)
              return (
                <div
                  key={idx}
                  className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-3"
                >
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    {/* Item Description */}
                    <div className="md:col-span-5 space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400">
                        Item Description #{idx + 1}
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={255}
                        list="catalog-suggestions"
                        value={item.item_description}
                        onChange={e => handleSelectCatalogItem(idx, e.target.value)}
                        placeholder="e.g. Freon R410A 13.6kg tank"
                        className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    {/* Qty & Unit */}
                    <div className="md:col-span-2 space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400">Qty</label>
                      <input
                        type="number"
                        min={1}
                        required
                        value={item.qty_requested}
                        onChange={e => updateLineItem(idx, 'qty_requested', Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400">Unit</label>
                      <select
                        value={item.unit}
                        onChange={e => updateLineItem(idx, 'unit', e.target.value)}
                        className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {UNITS.map(u => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>

                    {/* Est. Unit Price */}
                    <div className="md:col-span-2 space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400">Est. Price (₱)</label>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={item.est_unit_price || ''}
                        onChange={e => updateLineItem(idx, 'est_unit_price', Number(e.target.value))}
                        placeholder="0.00"
                        className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-right"
                      />
                    </div>

                    {/* Delete Action */}
                    <div className="md:col-span-1 flex items-end justify-center pt-3 md:pt-0">
                      <button
                        type="button"
                        onClick={() => removeLineItem(idx)}
                        disabled={lineItems.length === 1}
                        className="p-1.5 text-slate-500 hover:text-rose-400 disabled:opacity-30 transition-colors"
                        title="Delete item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Second row: Store Name & Camera Reference */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs">
                    <div className="flex items-center gap-2 flex-1 max-w-sm">
                      <span className="text-[10px] text-slate-400 shrink-0">Preferred Vendor:</span>
                      <input
                        type="text"
                        maxLength={150}
                        value={item.store_name || ''}
                        onChange={e => updateLineItem(idx, 'store_name', e.target.value)}
                        placeholder="e.g. Ace Hardware / Wilcon"
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 placeholder-slate-500"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <CameraCapture
                        bucket="item-references"
                        context="MRS_ITEM_REFERENCE"
                        label="Add Photo"
                        onUploadComplete={(url: string) => updateLineItem(idx, 'reference_photo_url', url)}
                      />
                      <span className="font-mono font-bold text-slate-300">
                        Line: ₱{lineTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Datalist for autocomplete */}
          <datalist id="catalog-suggestions">
            {catalogItems.map((c, i) => (
              <option key={i} value={c.item_description}>
                {c.store_name ? `${c.store_name} (₱${c.last_unit_price})` : ''}
              </option>
            ))}
          </datalist>
        </div>

        {/* Online Purchase Toggle */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-indigo-400" />
              <div>
                <span className="text-sm font-bold text-white block">Purchased Online?</span>
                <span className="text-xs text-slate-400">Shopee, Lazada, or supplier portal order</span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={isOnline}
              onChange={e => setIsOnline(e.target.checked)}
              className="w-5 h-5 accent-indigo-500 rounded cursor-pointer"
            />
          </div>

          {isOnline && (
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Product / Supplier URL</label>
                <input
                  type="url"
                  value={onlineUrl}
                  onChange={e => setOnlineUrl(e.target.value)}
                  placeholder="https://shopee.ph/product/..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Estimated Shipping Fee (₱)</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={estShipping || ''}
                    onChange={e => setEstShipping(Number(e.target.value))}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Cart / Price Screenshot</label>
                  <CameraCapture
                    bucket="item-references"
                    context="MRS_ONLINE_SCREENSHOT"
                    label="Upload Screenshot"
                    onUploadComplete={(url: string) => setOnlineScreenshotUrl(url)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Emergency Fast-Track Section (Plan.md §6.A) */}
        {canUseFastTrack && (
          <div className={`border rounded-2xl p-5 space-y-3 transition-colors ${
            isFastTrack
              ? 'bg-amber-950/30 border-amber-800/80'
              : 'bg-slate-900 border-slate-800'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                <div>
                  <span className="text-sm font-bold text-white block">
                    Emergency Fast-Track Option
                  </span>
                  <span className="text-xs text-slate-400">
                    Bypass Forms 6, 7, 8, 10 for emergency operational continuity (Cap: ₱3,000.00)
                  </span>
                </div>
              </div>

              <input
                type="checkbox"
                checked={isFastTrack}
                disabled={!costEligible}
                onChange={e => setIsFastTrack(e.target.checked)}
                className="w-5 h-5 accent-amber-500 rounded cursor-pointer disabled:opacity-40"
              />
            </div>

            {!costEligible && (
              <p className="text-xs text-rose-400">
                Disabled: Total estimated cost (₱{totalCost.toFixed(2)}) exceeds the ₱3,000.00 Fast-Track cap. Normal review pipeline required.
              </p>
            )}

            {isFastTrack && costEligible && (
              <p className="text-xs text-amber-300 bg-amber-950/60 p-2.5 rounded-lg border border-amber-800/60">
                ⚡ FAST-TRACK ENGAGED: Requester may proceed straight to purchase upon submission. A 24-hour post-audit badge will be logged for Manager review.
              </p>
            )}
          </div>
        )}

        {/* Order Summary & Submit Bar */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <span className="text-xs text-slate-400 block">Estimated Total Cost</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-white">
                ₱{totalCost.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              {isOnline && estShipping > 0 && (
                <span className="text-xs text-slate-400">
                  (incl. ₱{estShipping.toFixed(2)} shipping)
                </span>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || totalCost <= 0 || !joLinkEligible}
            className="w-full sm:w-auto px-8 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-xl shadow-blue-500/20 flex items-center justify-center gap-2 transition-colors"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
            <span>{submitting ? 'Submitting...' : 'Submit Requisition'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}

export default function MRSNewPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-slate-400">Loading form...</div>}>
      <MRSNewForm />
    </Suspense>
  )
}
