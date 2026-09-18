'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  X,
  Zap,
  Menu,
  ChevronRight,
  Layers,
  PlusCircle,
  CheckSquare,
  Clock,
  AlertOctagon,
  ShoppingCart,
  Boxes,
  ClipboardCheck,
  FileSearch,
  FileText,
  Send,
  PenSquare,
  Banknote,
  Store,
  PackageCheck,
  Calendar,
  Wind,
  BarChart3,
  ClipboardList,
  Users,
  Wrench,
  LayoutDashboard,
} from 'lucide-react'
import type { NavItem } from '@/lib/access-control'
import type { UserRole } from '@/types/index'

// Icon per catalog route (client-side only — server layouts pass plain data).
const ICONS: Record<string, React.ReactNode> = {
  '/dashboard': <LayoutDashboard className="w-5 h-5" />,
  '/jo/new': <Wrench className="w-5 h-5" />,
  '/jo/track': <CheckSquare className="w-5 h-5" />,
  '/jo/queue': <Clock className="w-5 h-5" />,
  '/jo/queue/escalated': <AlertOctagon className="w-5 h-5" />,
  '/mrs/new': <PlusCircle className="w-5 h-5" />,
  '/mrs/stock-check': <Boxes className="w-5 h-5" />,
  '/mrs/manager-queue': <ClipboardCheck className="w-5 h-5" />,
  '/mrs/canvass': <FileSearch className="w-5 h-5" />,
  '/mrs': <FileText className="w-5 h-5" />,
  '/transmittals': <Send className="w-5 h-5" />,
  '/transmittals/create': <PenSquare className="w-5 h-5" />,
  '/transmittals/accounting': <Banknote className="w-5 h-5" />,
  '/transmittals/front-desk': <Store className="w-5 h-5" />,
  '/purchaser/queue': <ShoppingCart className="w-5 h-5" />,
  '/delivery/verify': <PackageCheck className="w-5 h-5" />,
  '/pms': <Calendar className="w-5 h-5" />,
  '/pms/daily': <ClipboardCheck className="w-5 h-5" />,
  '/pms/aircon': <Wind className="w-5 h-5" />,
  '/pms/register': <PlusCircle className="w-5 h-5" />,
  '/reports/expense': <BarChart3 className="w-5 h-5" />,
  '/audit-logs': <ClipboardList className="w-5 h-5" />,
  '/admin/users': <Users className="w-5 h-5" />,
}

function iconFor(href: string): React.ReactNode {
  return ICONS[href] ?? <Layers className="w-5 h-5" />
}

interface MobileNavProps {
  role: UserRole
  /** All accessible catalog routes (grouped "More" sheet). */
  items: NavItem[]
  /** The role's primary forms (bottom bar tiles + FAB menu). */
  primary: NavItem[]
}

/**
 * Mobile navigation (md:hidden):
 *  - Fixed bottom bar with at most 5 thumb-reach tiles: the role's primary
 *    forms + Dashboard + a "More" button (opens the grouped full menu).
 *  - Floating quick-access button (role-focused) above the bar.
 * Replaces the previous 9-item justify-around bar that clipped labels on
 * small screens (especially for SUPER_ADMIN).
 */
export function MobileNav({ role, items, primary }: MobileNavProps) {
  const pathname = usePathname()
  const [showMoreSheet, setShowMoreSheet] = useState(false)
  const [showQuickMenu, setShowQuickMenu] = useState(false)

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)

  // Bottom bar: up to 3 role-primary tiles + Dashboard + More (max 5 total)
  const primaryTiles = primary.slice(0, 3).filter((p) => p.href !== '/dashboard')
  const tiles: NavItem[] = [
    ...primaryTiles,
    items.find((i) => i.href === '/dashboard') ?? {
      href: '/dashboard',
      label: 'Dashboard',
      group: 'Overview',
    },
  ].slice(0, 4)

  // Grouped catalog for the "More" sheet
  const groups = items.reduce<Record<string, NavItem[]>>((acc, item) => {
    ;(acc[item.group] ??= []).push(item)
    return acc
  }, {})

  const quickItems = primary.length > 0
    ? primary
    : items.slice(0, 4)

  return (
    <>
      {/* Floating role quick-access button (above the bottom bar) */}
      <div className="md:hidden fixed right-4 z-40" style={{ bottom: '5.5rem' }}>
        {showQuickMenu && (
          <div className="absolute bottom-16 right-0 w-72 max-w-[calc(100vw-2rem)] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-black text-white flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> Quick Access
                </span>
                <span className="text-[10px] text-slate-400">{role} workspace</span>
              </div>
              <button
                type="button"
                aria-label="Close quick menu"
                onClick={() => setShowQuickMenu(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 space-y-1">
              {quickItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setShowQuickMenu(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                    isActive(item.href)
                      ? 'bg-blue-600/20 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <span className="shrink-0 text-slate-400">{iconFor(item.href)}</span>
                  <span className="text-xs font-semibold flex-1 truncate">{item.label}</span>
                  {item.formLabel && (
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-800 text-blue-300 border border-slate-700 shrink-0">
                      {item.formLabel}
                    </span>
                  )}
                </Link>
              ))}
              <button
                type="button"
                onClick={() => {
                  setShowQuickMenu(false)
                  setShowMoreSheet(true)
                }}
                className="w-full flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-[11px] font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <span>Browse all shortcuts</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          aria-label={`Quick actions for ${role}`}
          onClick={() => setShowQuickMenu((v) => !v)}
          className="w-14 h-14 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white shadow-xl shadow-blue-600/40 flex items-center justify-center active:scale-95 transition-all"
        >
          {showQuickMenu ? <X className="w-6 h-6" /> : <Zap className="w-6 h-6" />}
        </button>
      </div>

      {/* Bottom navigation bar (max 5 tiles: role-primary + Dashboard + More) */}
      <nav
        aria-label="Primary"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800"
      >
        <div className="flex items-stretch justify-around">
          {tiles.map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              aria-label={tile.label}
              className={`flex flex-col items-center justify-center gap-1 flex-1 min-w-0 py-2.5 px-1 ${
                isActive(tile.href) ? 'text-blue-400' : 'text-slate-400'
              }`}
            >
              {iconFor(tile.href)}
              <span className="text-[10px] font-semibold truncate max-w-full">{tile.label}</span>
            </Link>
          ))}

          {/* More button — opens the grouped full menu */}
          <button
            type="button"
            aria-label="All shortcuts"
            onClick={() => setShowMoreSheet(true)}
            className="flex flex-col items-center justify-center gap-1 flex-1 min-w-0 py-2.5 px-1 text-slate-400"
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] font-semibold">More</span>
          </button>
        </div>
      </nav>

      {/* "More" bottom sheet — every accessible route, grouped */}
      {showMoreSheet && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end justify-center">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setShowMoreSheet(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-label="All shortcuts"
            className="relative w-full max-w-lg bg-slate-900 border-t border-x border-slate-700 rounded-t-3xl max-h-[82vh] flex flex-col shadow-2xl shadow-black/60"
          >
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-sm font-black text-white">All Shortcuts</span>
                <span className="text-[11px] text-slate-400 block">
                  {role} · {items.length} screens
                </span>
              </div>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setShowMoreSheet(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-3 space-y-4">
              {Object.entries(groups).map(([group, groupItems]) => (
                <div key={group}>
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 px-2 block mb-1.5">
                    {group}
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {groupItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setShowMoreSheet(false)}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-colors ${
                          isActive(item.href)
                            ? 'bg-blue-600/20 border-blue-700/60 text-white'
                            : 'bg-slate-950/60 border-slate-800 text-slate-300 active:bg-slate-800'
                        }`}
                      >
                        <span className="shrink-0 text-slate-400">{iconFor(item.href)}</span>
                        <span className="min-w-0">
                          <span className="text-xs font-semibold block truncate">{item.label}</span>
                          {item.formLabel && (
                            <span className="text-[9px] font-mono text-slate-500">{item.formLabel}</span>
                          )}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
