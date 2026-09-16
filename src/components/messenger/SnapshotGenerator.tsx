'use client'

import React, { useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import {
  Copy,
  Download,
  FileText,
  Check,
  Loader2,
  AlertCircle,
  Share2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export interface CanvassSnapshotItem {
  description: string
  quantity: number
  unit: string
  supplier: string
  unitPrice: number
  shippingFee?: number
  isOverpriced?: boolean
}

export interface CanvassSnapshotData {
  mrsNumber: string
  joNumber?: string
  department: string
  requesterName: string
  purpose: string
  date: string
  totalBudget: number
  items: CanvassSnapshotItem[]
}

export interface SnapshotGeneratorProps {
  /** Optional custom DOM element ref to capture. If not provided, the built-in canvass card is rendered and captured. */
  targetRef?: React.RefObject<HTMLElement | null>
  /** Data used to render the built-in high-contrast executive canvass card */
  data?: CanvassSnapshotData
  /** Called when snapshot image is uploaded to Supabase Storage */
  onUploaded?: (publicUrl: string) => void
  /** Base filename for downloads (without extension) */
  fileName?: string
}

export function SnapshotGenerator({
  targetRef,
  data,
  onUploaded,
  fileName = 'FixFlow-Canvass-Snapshot',
}: SnapshotGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const internalCardRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  // Get the DOM element to render
  const getCaptureElement = (): HTMLElement | null => {
    if (targetRef && targetRef.current) return targetRef.current
    return internalCardRef.current
  }

  // Generate canvas using html2canvas with high-DPI scaling
  const generateCanvas = async (): Promise<HTMLCanvasElement> => {
    const el = getCaptureElement()
    if (!el) throw new Error('No capture target element found.')

    return await html2canvas(el, {
      scale: 2, // 2x resolution for crisp Messenger/WhatsApp reading
      backgroundColor: '#0f172a', // Clean slate-900 background
      logging: false,
      useCORS: true,
      allowTaint: true,
    })
  }

  // Action 1: Copy PNG image directly to clipboard
  const handleCopyImage = async () => {
    setIsGenerating(true)
    setError(null)
    setStatusMessage('Generating image for clipboard...')

    try {
      const canvas = await generateCanvas()

      canvas.toBlob(async (blob) => {
        if (!blob) throw new Error('Failed to create image blob.')

        // Check if ClipboardItem is supported for images
        if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob }),
            ])
            setCopied(true)
            setStatusMessage('✓ Copied image to clipboard! Ready to paste into Messenger/WhatsApp.')
            setTimeout(() => {
              setCopied(false)
              setStatusMessage(null)
            }, 4000)
          } catch (clipErr) {
            console.warn('Clipboard write failed, triggering PNG download fallback:', clipErr)
            handleDownloadPNG()
          }
        } else {
          // Fallback to downloading
          handleDownloadPNG()
        }
      }, 'image/png')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not generate snapshot image.'
      setError(msg)
    } finally {
      setIsGenerating(false)
    }
  }

  // Action 2: Download PNG
  const handleDownloadPNG = async () => {
    setIsGenerating(true)
    setError(null)
    setStatusMessage('Rendering PNG...')

    try {
      const canvas = await generateCanvas()
      const dataUrl = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.download = `${fileName}-${Date.now()}.png`
      link.href = dataUrl
      link.click()
      setStatusMessage('✓ PNG downloaded successfully.')
      setTimeout(() => setStatusMessage(null), 3000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to download PNG.'
      setError(msg)
    } finally {
      setIsGenerating(false)
    }
  }

  // Action 3: Download PDF
  const handleDownloadPDF = async () => {
    setIsGenerating(true)
    setError(null)
    setStatusMessage('Rendering PDF...')

    try {
      const canvas = await generateCanvas()
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvas.width, canvas.height],
      })

      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height)
      pdf.save(`${fileName}-${Date.now()}.pdf`)
      setStatusMessage('✓ PDF downloaded successfully.')
      setTimeout(() => setStatusMessage(null), 3000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate PDF.'
      setError(msg)
    } finally {
      setIsGenerating(false)
    }
  }

  // Action 4: Upload snapshot to Supabase Storage 'messenger-snapshots' bucket
  const handleUploadAndShare = async () => {
    setIsGenerating(true)
    setError(null)
    setStatusMessage('Uploading snapshot to cloud storage...')

    try {
      const canvas = await generateCanvas()

      canvas.toBlob(async (blob) => {
        if (!blob) throw new Error('Failed to create image blob.')

        const filePath = `snapshots/${fileName}_${Date.now()}.png`
        const { error: uploadError } = await supabase.storage
          .from('messenger-snapshots')
          .upload(filePath, blob, {
            contentType: 'image/png',
            upsert: true,
          })

        if (uploadError) throw uploadError

        const { data: { publicUrl } } = supabase.storage
          .from('messenger-snapshots')
          .getPublicUrl(filePath)

        onUploaded?.(publicUrl)
        setStatusMessage('✓ Snapshot uploaded to cloud storage.')
        setTimeout(() => setStatusMessage(null), 4000)
      }, 'image/png')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to upload snapshot.'
      setError(msg)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="w-full space-y-4">
      {/* Control Buttons Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCopyImage}
          disabled={isGenerating}
          className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors disabled:opacity-50"
          title="Copy image to paste into Facebook Messenger or WhatsApp"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? 'Copied Image!' : 'Copy Image for Messenger'}</span>
        </button>

        <button
          type="button"
          onClick={handleDownloadPNG}
          disabled={isGenerating}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Download className="w-4 h-4 text-slate-300" />
          <span>Download PNG</span>
        </button>

        <button
          type="button"
          onClick={handleDownloadPDF}
          disabled={isGenerating}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <FileText className="w-4 h-4 text-slate-300" />
          <span>PDF Report</span>
        </button>

        {onUploaded && (
          <button
            type="button"
            onClick={handleUploadAndShare}
            disabled={isGenerating}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Share2 className="w-4 h-4 text-emerald-400" />
            <span>Save Cloud Link</span>
          </button>
        )}
      </div>

      {/* Generating Loader / Feedback Banner */}
      {isGenerating && (
        <div className="flex items-center gap-2 text-xs text-blue-300 bg-blue-950/40 border border-blue-900/50 p-2.5 rounded-lg">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          <span>{statusMessage || 'Processing snapshot...'}</span>
        </div>
      )}

      {statusMessage && !isGenerating && (
        <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800/60 p-2.5 rounded-lg">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{statusMessage}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-800 p-2.5 rounded-lg">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Built-in high-contrast executive canvass card for snapshotting */}
      {data && !targetRef && (
        <div
          ref={internalCardRef}
          className="w-full max-w-xl mx-auto p-6 bg-slate-950 text-slate-100 rounded-2xl border border-slate-800 shadow-2xl space-y-5 font-sans"
        >
          {/* Header Banner */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold tracking-tight text-white">FixFlow ERP</span>
                <span className="px-2 py-0.5 text-xs font-semibold rounded bg-blue-600/30 text-blue-300 border border-blue-500/40">
                  CANVASS SUMMARY
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Owner Approval Request</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-sm font-bold text-blue-400">{data.mrsNumber}</p>
              {data.joNumber && (
                <p className="text-xs text-slate-400">Ref: {data.joNumber}</p>
              )}
            </div>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs bg-slate-900/80 p-3 rounded-xl border border-slate-800/80">
            <div>
              <span className="text-slate-400 block">Department:</span>
              <span className="font-semibold text-slate-200">{data.department}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Date:</span>
              <span className="font-semibold text-slate-200">{data.date}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Requester:</span>
              <span className="font-semibold text-slate-200">{data.requesterName}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Purpose:</span>
              <span className="font-semibold text-slate-200 truncate block">{data.purpose}</span>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Canvassed Items & Suppliers
            </p>
            <div className="border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-400 font-medium border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-3">Item</th>
                    <th className="py-2 px-2 text-center">Qty</th>
                    <th className="py-2 px-2">Supplier</th>
                    <th className="py-2 px-3 text-right">Unit (₱)</th>
                    <th className="py-2 px-3 text-right">Total (₱)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-950/60">
                  {data.items.map((it, idx) => {
                    const lineTotal = it.quantity * it.unitPrice + (it.shippingFee ?? 0)
                    return (
                      <tr key={idx} className="hover:bg-slate-900/40">
                        <td className="py-2 px-3 text-slate-200">
                          <span className="font-medium">{it.description}</span>
                          {it.isOverpriced && (
                            <span className="ml-1.5 text-[10px] text-amber-400 font-semibold">⚠️ Catalog Alert</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center text-slate-300">
                          {it.quantity} {it.unit}
                        </td>
                        <td className="py-2 px-2 text-slate-400 truncate max-w-[100px]">{it.supplier}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-300">
                          ₱{it.unitPrice.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-semibold text-slate-100">
                          ₱{lineTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Total Budget Card */}
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-950/60 to-slate-900 border border-blue-900/60 rounded-xl">
            <div>
              <span className="text-xs uppercase tracking-wider text-blue-300 font-semibold block">
                Total Allocated Budget
              </span>
              <span className="text-[11px] text-slate-400">Requires Executive Decision</span>
            </div>
            <div className="text-right">
              <span className="text-2xl font-black font-mono text-emerald-400 tracking-tight">
                ₱{data.totalBudget.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Quick Decision Instruction Footer */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span>Reply <b>&quot;APPROVED&quot;</b> or <b>&quot;REJECTED&quot;</b> to this message</span>
            <span className="font-mono text-slate-400">FixFlow ERP • Manila</span>
          </div>
        </div>
      )}
    </div>
  )
}
