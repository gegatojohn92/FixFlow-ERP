'use client'

import React, { useState } from 'react'
import {
  X,
  Share2,
  Copy,
  Check,
  MessageCircle,
  Phone,
  Send,
  ExternalLink,
  ShieldAlert,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react'

export interface DeepLinkModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  entityNumber: string // e.g. "MRS-2026-000012" or "JO-2026-000045"
  entityType: 'MRS' | 'JO' | 'EXPENSE_REPORT'
  summaryText: string
  totalAmount?: number
  deepLinkPath?: string // e.g. "/mrs/view?id=12"
  onRecordOwnerDecision?: (decision: 'APPROVED' | 'REJECTED', notes?: string) => Promise<void>
}

export function DeepLinkModal({
  isOpen,
  onClose,
  title = 'Share via Messenger / WhatsApp',
  entityNumber,
  entityType,
  summaryText,
  totalAmount,
  deepLinkPath,
  onRecordOwnerDecision,
}: DeepLinkModalProps) {
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedMessage, setCopiedMessage] = useState(false)
  const [decisionNotes, setDecisionNotes] = useState('')
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false)
  const [activeTab, setActiveTab] = useState<'share' | 'decision'>('share')

  if (!isOpen) return null

  // Generate full origin URL for the deep link
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const fullUrl = deepLinkPath ? `${origin}${deepLinkPath}` : origin

  // Formatted chat message ready for Messenger/WhatsApp
  const formattedChatText = [
    `📋 *FixFlow ERP — ${entityType} ${entityNumber}*`,
    totalAmount ? `💰 *Total Budget:* ₱${totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : null,
    `📝 *Details:* ${summaryText}`,
    `🔗 *View Document:* ${fullUrl}`,
    ``,
    `👉 Please reply *APPROVED* or *REJECTED* to confirm.`,
  ]
    .filter(Boolean)
    .join('\n')

  const handleCopyLinkOnly = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 3000)
    } catch {
      // Fallback
    }
  }

  const handleCopyFullMessage = async () => {
    try {
      await navigator.clipboard.writeText(formattedChatText)
      setCopiedMessage(true)
      setTimeout(() => setCopiedMessage(false), 3000)
    } catch {
      // Fallback
    }
  }

  const handleWebShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `FixFlow ERP: ${entityNumber}`,
          text: formattedChatText,
          url: fullUrl,
        })
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.warn('Web Share failed:', err)
        }
      }
    } else {
      handleCopyFullMessage()
    }
  }

  // Messenger / Chat platform share URLs
  const encodedText = encodeURIComponent(formattedChatText)
  const whatsappUrl = `https://wa.me/?text=${encodedText}`
  const viberUrl = `viber://forward?text=${encodedText}`
  const smsUrl = `sms:?body=${encodedText}`
  // Facebook Messenger web intent / dialog
  const messengerUrl = `https://www.facebook.com/dialog/send?link=${encodeURIComponent(fullUrl)}&app_id=291494419107518&redirect_uri=${encodeURIComponent(fullUrl)}`

  const handleDecisionSubmit = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!onRecordOwnerDecision) return
    setIsSubmittingDecision(true)
    try {
      await onRecordOwnerDecision(decision, decisionNotes.trim() || undefined)
      onClose()
    } catch (err) {
      console.error('Failed to log owner decision:', err)
    } finally {
      setIsSubmittingDecision(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 font-sans">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{title}</h3>
              <p className="text-xs text-slate-400 font-mono">{entityNumber}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation if decision callback provided */}
        {onRecordOwnerDecision && (
          <div className="grid grid-cols-2 border-b border-slate-800 bg-slate-950/40 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('share')}
              className={`py-2.5 px-4 transition-colors border-b-2 ${
                activeTab === 'share'
                  ? 'border-blue-500 text-blue-400 bg-slate-800/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              1. Share Deep Link
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('decision')}
              className={`py-2.5 px-4 transition-colors border-b-2 ${
                activeTab === 'decision'
                  ? 'border-emerald-500 text-emerald-400 bg-slate-800/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              2. Record Owner Reply
            </button>
          </div>
        )}

        <div className="p-5 space-y-4">
          {activeTab === 'share' ? (
            <>
              {/* Formatted Message Preview Box */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Formatted Chat Message:</span>
                  <button
                    type="button"
                    onClick={handleCopyFullMessage}
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium"
                  >
                    {copiedMessage ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedMessage ? 'Copied Full Text!' : 'Copy Text'}</span>
                  </button>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-slate-300 whitespace-pre-wrap max-h-36 overflow-y-auto leading-relaxed">
                  {formattedChatText}
                </div>
              </div>

              {/* Share Channels Grid */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                  Send directly to Messenger / App:
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {/* WhatsApp */}
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 hover:bg-emerald-900/40 text-emerald-300 font-semibold transition-colors"
                  >
                    <MessageCircle className="w-4 h-4 text-emerald-400" />
                    <span>WhatsApp</span>
                  </a>

                  {/* Facebook Messenger */}
                  <a
                    href={messengerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2.5 rounded-xl bg-blue-950/40 border border-blue-800/60 hover:bg-blue-900/40 text-blue-300 font-semibold transition-colors"
                  >
                    <Send className="w-4 h-4 text-blue-400" />
                    <span>FB Messenger</span>
                  </a>

                  {/* Viber */}
                  <a
                    href={viberUrl}
                    className="flex items-center gap-2 p-2.5 rounded-xl bg-purple-950/40 border border-purple-800/60 hover:bg-purple-900/40 text-purple-300 font-semibold transition-colors"
                  >
                    <Phone className="w-4 h-4 text-purple-400" />
                    <span>Viber</span>
                  </a>

                  {/* SMS / Mobile */}
                  <a
                    href={smsUrl}
                    className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-800/70 border border-slate-700 hover:bg-slate-800 text-slate-200 font-semibold transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 text-slate-400" />
                    <span>SMS / Text</span>
                  </a>
                </div>
              </div>

              {/* Native Mobile Share Button */}
              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button
                  type="button"
                  onClick={handleWebShare}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs transition-all shadow-md"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Open System Share Sheet (iOS / Android)</span>
                </button>
              )}

              {/* Copy URL Row */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                <input
                  type="text"
                  readOnly
                  value={fullUrl}
                  className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-slate-400 select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyLinkOnly}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-medium text-slate-200 transition-colors flex items-center gap-1 shrink-0"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLink ? 'Copied' : 'Copy URL'}</span>
                </button>
              </div>
            </>
          ) : (
            /* Tab 2: Record Owner's Off-Platform Reply */
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-950/30 border border-amber-800/50 text-amber-300 text-xs leading-relaxed">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                <span>
                  <b>Frictionless Owner Approval Rule (§1):</b> Executive responses received via
                  Messenger/WhatsApp/Call are officially logged back into the system by the Budget Officer.
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">
                  Owner Notes / Rejection Reason (Required if Rejected):
                </label>
                <textarea
                  rows={3}
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  placeholder="e.g. Approved via Messenger chat at 2:30 PM. / Rejected: Price for item 2 exceeds expectations..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  disabled={isSubmittingDecision}
                  onClick={() => handleDecisionSubmit('APPROVED')}
                  className="flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50 shadow-md"
                >
                  <ThumbsUp className="w-4 h-4" />
                  <span>Log APPROVED</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmittingDecision}
                  onClick={() => handleDecisionSubmit('REJECTED')}
                  className="flex items-center justify-center gap-2 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50 shadow-md"
                >
                  <ThumbsDown className="w-4 h-4" />
                  <span>Log REJECTED</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
