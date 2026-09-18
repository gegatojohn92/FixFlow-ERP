'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, PackageX, PackageCheck, ClipboardCheck, Loader2 } from 'lucide-react'
import { getMyAlerts, type UserAlert, type AlertKind } from '@/lib/actions/alert-actions'

const ICONS: Record<AlertKind, React.ReactNode> = {
  AVAILABILITY_DECISION: <PackageX className="w-3.5 h-3.5 text-amber-400 shrink-0" />,
  AVAILABILITY_ANSWERED: <PackageCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />,
  DELIVERY_SIGN_OFF: <ClipboardCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />,
}

/** Header bell: live count of requisitions waiting on the signed-in user. */
export function AlertBell() {
  const [alerts, setAlerts] = useState<UserAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const result = await getMyAlerts()
    setAlerts(result.alerts)
    setLoading(false)
  }, [])

  // Re-read on navigation: acting on an alert (e.g. answering a hold) should
  // clear it without a manual refresh.
  useEffect(() => {
    // `load` awaits the server action before setting state, so nothing is set
    // synchronously in this effect body; the rule cannot see past the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, pathname])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const count = alerts.length

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={count > 0 ? `Notifications — ${count} need attention` : 'Notifications'}
        title={count > 0 ? `${count} item(s) need your attention` : 'Nothing needs your attention'}
        className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors relative"
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-rose-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center border border-slate-900">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-200 uppercase tracking-wide">
              Needs your attention
            </span>
            {count > 0 && (
              <span className="text-[10px] font-mono text-slate-400">{count}</span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-800">
            {loading ? (
              <div className="px-3 py-6 flex items-center justify-center gap-2 text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-[11px]">Checking…</span>
              </div>
            ) : count === 0 ? (
              <p className="px-3 py-6 text-[11px] text-slate-500 text-center">
                Nothing is waiting on you right now.
              </p>
            ) : (
              alerts.map(alert => (
                <Link
                  key={`${alert.kind}-${alert.mrsId}`}
                  href={alert.href}
                  prefetch
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-800/70 transition-colors"
                >
                  {ICONS[alert.kind]}
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold text-slate-100 truncate">
                      {alert.title}
                    </span>
                    <span className="block text-[10px] text-slate-400 line-clamp-2">
                      {alert.detail}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
