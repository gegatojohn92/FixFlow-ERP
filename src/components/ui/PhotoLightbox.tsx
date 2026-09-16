'use client'

import React, { useEffect } from 'react'
import { X, ExternalLink, Download, Image as ImageIcon, ZoomIn } from 'lucide-react'

interface PhotoLightboxProps {
  isOpen: boolean
  onClose: () => void
  imageUrl: string | null
  title?: string
  context?: string
}

export function PhotoLightbox({
  isOpen,
  onClose,
  imageUrl,
  title = 'Attached Photo',
  context,
}: PhotoLightboxProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !imageUrl) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl w-full max-h-[92vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-400">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white leading-tight truncate max-w-sm sm:max-w-md">
                {title}
              </h3>
              {context && (
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                  {context.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors"
              title="Open full size image in a new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Open Full Size</span>
            </a>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Close viewer (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Image Container */}
        <div className="relative flex-1 min-h-[320px] max-h-[75vh] flex items-center justify-center p-4 bg-slate-950 overflow-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={title}
            className="max-w-full max-h-[72vh] object-contain rounded-lg shadow-lg border border-slate-800/80 transition-all select-none"
            onError={(e) => {
              const target = e.currentTarget
              target.onerror = null
              target.style.display = 'none'
              const parent = target.parentElement
              if (parent) {
                const fallback = document.createElement('div')
                fallback.className = 'text-center p-8 text-slate-400 space-y-2'
                fallback.innerHTML = `
                  <div class="w-12 h-12 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-400 flex items-center justify-center mx-auto mb-2">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  </div>
                  <p class="text-sm font-semibold text-white">Image could not be loaded</p>
                  <p class="text-xs text-slate-400">The storage bucket may be private or the file is no longer accessible.</p>
                  <a href="${imageUrl}" target="_blank" class="inline-block mt-2 text-xs text-blue-400 underline hover:text-blue-300">Attempt direct link</a>
                `
                parent.appendChild(fallback)
              }
            }}
          />
        </div>

        {/* Footer info */}
        <div className="px-5 py-2.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <ZoomIn className="w-3.5 h-3.5 text-slate-400" /> Click outside or press Esc to exit
          </span>
          <span className="truncate max-w-xs font-mono text-[10px] text-slate-400">
            {imageUrl.split('/').pop()}
          </span>
        </div>
      </div>
    </div>
  )
}

export default PhotoLightbox
