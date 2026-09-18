'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, LayoutDashboard, RefreshCw } from 'lucide-react'

/**
 * Last line of defense for the whole dashboard tree.
 *
 * If a Server Component render fails (e.g. a session/network hiccup reaching
 * Supabase that slips past getServerUser()), users see this recovery card
 * instead of a blank page and an opaque "Minified React error #441" in the
 * console. Data already saved by a completed action is never affected.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Keep the real error in the console for debugging (dev builds log it
    // automatically; production minifies it, so we log it explicitly here).
    console.error('Dashboard render error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-5">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-950/70 border border-rose-800/70 text-rose-400 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-lg font-black text-white">Something went wrong</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            This page could not be rendered — usually a temporary session or network
            hiccup. Your saved data is safe; try reloading. If it keeps happening,
            sign out and sign in again.
          </p>
        </div>

        {error.digest && (
          <p className="text-[10px] font-mono text-slate-600">reference: {error.digest}</p>
        )}

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try Again
          </button>
          <Link
            href="/dashboard"
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
