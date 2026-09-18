import React from 'react'
import Link from 'next/link'
import {
  Wrench,
  LogOut,
  Bell,
  Zap,
  LayoutDashboard,
  PlusCircle,
  CheckSquare,
  Clock,
  AlertOctagon,
  Boxes,
  ClipboardCheck,
  FileSearch,
  FileText,
  Calendar,
  Wind,
  ShoppingCart,
  Send,
  PenSquare,
  Banknote,
  Store,
  PackageCheck,
  BarChart3,
  ClipboardList,
  Users,
} from 'lucide-react'
import { createClient, getServerUser } from '@/lib/supabase/server'
import {
  getNavItemsForRole,
  getPrimaryActionsForRole,
  type NavItem,
} from '@/lib/access-control'
import { MobileNav } from '@/components/layout/MobileNav'
import { ActionLockProvider } from '@/components/ui/ActionLock'
import { RoutePrefetcher } from '@/components/layout/RoutePrefetcher'
import type { UserRole } from '@/types/index'
import { redirect } from 'next/navigation'

// Desktop icon per catalog route (kept in the server layout; the mobile
// variant has its own client-side map in MobileNav.tsx).
const DESKTOP_ICONS: Record<string, React.ReactNode> = {
  '/dashboard': <LayoutDashboard className="w-3.5 h-3.5 text-slate-300" />,
  '/jo/new': <PlusCircle className="w-3.5 h-3.5 text-blue-400" />,
  '/jo/track': <CheckSquare className="w-3.5 h-3.5 text-slate-300" />,
  '/jo/queue': <Clock className="w-3.5 h-3.5 text-amber-400" />,
  '/jo/queue/escalated': <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />,
  '/mrs/new': <PlusCircle className="w-3.5 h-3.5 text-purple-400" />,
  '/mrs/stock-check': <Boxes className="w-3.5 h-3.5 text-amber-400" />,
  '/mrs/manager-queue': <ClipboardCheck className="w-3.5 h-3.5 text-blue-400" />,
  '/mrs/canvass': <FileSearch className="w-3.5 h-3.5 text-purple-400" />,
  '/mrs': <FileText className="w-3.5 h-3.5 text-purple-400" />,
  '/transmittals': <Send className="w-3.5 h-3.5 text-emerald-400" />,
  '/transmittals/create': <PenSquare className="w-3.5 h-3.5 text-emerald-400" />,
  '/transmittals/accounting': <Banknote className="w-3.5 h-3.5 text-violet-400" />,
  '/transmittals/front-desk': <Store className="w-3.5 h-3.5 text-teal-400" />,
  '/purchaser/queue': <ShoppingCart className="w-3.5 h-3.5 text-emerald-400" />,
  '/delivery/verify': <PackageCheck className="w-3.5 h-3.5 text-cyan-400" />,
  '/pms': <Calendar className="w-3.5 h-3.5 text-emerald-400" />,
  '/pms/daily': <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" />,
  '/pms/aircon': <Wind className="w-3.5 h-3.5 text-sky-400" />,
  '/pms/register': <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />,
  '/reports/expense': <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />,
  '/audit-logs': <ClipboardList className="w-3.5 h-3.5 text-cyan-400" />,
  '/admin/users': <Users className="w-3.5 h-3.5 text-pink-400" />,
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // getServerUser() never throws: an expired/rotated session or a transient
  // network failure reaching Supabase Auth becomes a clean /login redirect
  // instead of crashing the Server Component render (prod: "React error #441").
  const user = await getServerUser()

  if (!user) {
    redirect('/login')
  }

  const supabase = await createClient()

  // Fetch user role and department name
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role, department:departments(department_name)')
    .eq('id', user.id)
    .single()

  const role: UserRole = (profile?.role ?? 'STAFF') as UserRole
  const fullName = profile?.full_name ?? user.email ?? 'User'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const departmentName = (profile?.department as any)?.department_name ?? 'General'

  // Role-scoped navigation (single source of truth: access-control.ts)
  const navItems = getNavItemsForRole(role)
  const primaryActions: NavItem[] = getPrimaryActionsForRole(role)

  return (
    <ActionLockProvider>
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Warm the router cache for this role's primary forms so the first
          navigation to them is instant (see RoutePrefetcher). */}
      <RoutePrefetcher hrefs={primaryActions.map((item) => item.href)} />
      {/* Top Application Header */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto flex items-center gap-3 px-4 lg:px-8 py-3">
          {/* Brand Logo & Tagline */}
          <Link href="/dashboard" className="flex items-center gap-2.5 group shrink-0">
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <Wrench className="w-4 h-4" />
            </div>
            <div className="hidden sm:block">
              <span className="text-base font-black tracking-tight text-white block leading-none">
                FixFlow<span className="text-blue-500 font-normal ml-0.5">ERP</span>
              </span>
              <span className="text-[10px] text-slate-400 font-medium tracking-wide">
                OPERATIONS & PMS
              </span>
            </div>
          </Link>

          {/* Quick Nav Pill Links — horizontally scrollable so nothing is hidden
              on tablet widths (especially SUPER_ADMIN with the full catalog) */}
          <nav
            aria-label="Primary"
            className="hidden md:flex flex-1 min-w-0 items-center gap-1 text-xs font-semibold overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {navItems.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                prefetch
                className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                {DESKTOP_ICONS[link.href] ?? null}
                <span>{link.label}</span>
              </Link>
            ))}
          </nav>

          {/* Profile & Controls */}
          <div className="flex items-center gap-3 shrink-0 ml-auto">
            <button
              type="button"
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors relative"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full absolute top-1.5 right-1.5" />
            </button>

            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-semibold text-slate-200 leading-tight truncate max-w-[140px]">
                {fullName}
              </span>
              <div className="flex items-center justify-end gap-1.5 mt-0.5">
                <span className="text-[10px] text-slate-400">{departmentName}</span>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-950/80 text-blue-400 border border-blue-900/60">
                  {role}
                </span>
              </div>
            </div>

            {/* Logout Action */}
            <form action="/api/auth/signout" method="POST">
              <button
                type="submit"
                className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>

        {/* Role-focused quick workspace row (desktop) — the 2–4 forms this
            role works with most, straight from the role matrix */}
        <div className="hidden md:block border-t border-slate-800/60 bg-slate-950/40">
          <div className="max-w-7xl mx-auto flex items-center gap-2 px-4 lg:px-8 py-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1 shrink-0">
              <Zap className="w-3 h-3 text-amber-400" />
              Your workspace
            </span>
            {primaryActions.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 hover:border-blue-500/60 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                {DESKTOP_ICONS[item.href] ?? null}
                <span>{item.label}</span>
                {item.formLabel && (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-950/70 text-blue-300 border border-blue-900/60">
                    {item.formLabel}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 pb-24 md:pb-8">
        {children}
      </main>

      {/* Mobile: role-focused bottom bar + floating quick-access (FAB) */}
      <MobileNav role={role} items={navItems} primary={primaryActions} />
    </div>
    </ActionLockProvider>
  )
}
