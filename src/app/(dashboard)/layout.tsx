import React from 'react'
import Link from 'next/link'
import {
  Wrench,
  LogOut,
  Bell,
  Layers,
  PlusCircle,
  Clock,
  CheckSquare,
  Calendar,
  ShoppingCart,
  Send,
  Banknote,
  BarChart3,
  Users,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch user role and department name
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role, department:departments(name)')
    .eq('id', user.id)
    .single()

  const role = profile?.role ?? 'STAFF'
  const fullName = profile?.full_name ?? user.email ?? 'User'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const departmentName = (profile?.department as any)?.name ?? 'General'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Application Header */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Brand Logo & Tagline */}
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform">
                <Wrench className="w-4 h-4" />
              </div>
              <div>
                <span className="text-base font-black tracking-tight text-white block leading-none">
                  FixFlow<span className="text-blue-500 font-normal ml-0.5">ERP</span>
                </span>
                <span className="text-[10px] text-slate-400 font-medium tracking-wide">
                  OPERATIONS & PMS
                </span>
              </div>
            </Link>
          </div>

          {/* Quick Nav Pill Links */}
          <nav className="hidden md:flex items-center gap-1 text-xs font-semibold">
            <Link
              href="/dashboard"
              className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/jo/new"
              className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1"
            >
              <PlusCircle className="w-3.5 h-3.5 text-blue-400" />
              <span>New JO</span>
            </Link>
            <Link
              href="/jo/track"
              className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Track JO
            </Link>
            {(['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE'] as string[]).includes(role) && (
              <Link
                href="/jo/queue"
                className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1"
              >
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Tech Queue</span>
              </Link>
            )}
            {(['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE'] as string[]).includes(role) && (
              <Link
                href="/pms"
                className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1"
              >
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                <span>PMS</span>
              </Link>
            )}
            <Link
              href="/mrs"
              className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1"
            >
              <ShoppingCart className="w-3.5 h-3.5 text-purple-400" />
              <span>Requisitions</span>
            </Link>
            {(['SUPER_ADMIN', 'BUDGET_OFFICER', 'ACCOUNTING'] as string[]).includes(role) && (
              <Link
                href="/transmittals/create"
                className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1"
              >
                <Send className="w-3.5 h-3.5 text-emerald-400" />
                <span>Transmittals</span>
              </Link>
            )}
            {(['SUPER_ADMIN', 'ACCOUNTING'] as string[]).includes(role) && (
              <Link
                href="/transmittals/accounting"
                className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1"
              >
                <Banknote className="w-3.5 h-3.5 text-violet-400" />
                <span>Accounting</span>
              </Link>
            )}
            <Link
              href="/reports/expense"
              className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1"
            >
              <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />
              <span>Reports</span>
            </Link>
            {(['SUPER_ADMIN', 'MANAGER'] as string[]).includes(role) && (
              <Link
                href="/admin/users"
                className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1"
              >
                <Users className="w-3.5 h-3.5 text-pink-400" />
                <span>Users</span>
              </Link>
            )}
          </nav>

          {/* Profile & Controls */}
          <div className="flex items-center gap-3">
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
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 pb-20 md:pb-8">
        {children}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 py-2 px-3 flex items-center justify-around text-[10px]">
        <Link
          href="/dashboard"
          className="flex flex-col items-center gap-1 text-slate-400 hover:text-white"
        >
          <Layers className="w-4 h-4" />
          <span>Overview</span>
        </Link>
        <Link
          href="/jo/new"
          className="flex flex-col items-center gap-1 text-blue-400 font-semibold"
        >
          <PlusCircle className="w-4 h-4" />
          <span>New JO</span>
        </Link>
        <Link
          href="/jo/track"
          className="flex flex-col items-center gap-1 text-slate-400 hover:text-white"
        >
          <CheckSquare className="w-4 h-4" />
          <span>Track</span>
        </Link>
        {(['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE'] as string[]).includes(role) && (
          <Link
            href="/jo/queue"
            className="flex flex-col items-center gap-1 text-slate-400 hover:text-white"
          >
            <Clock className="w-4 h-4 text-amber-400" />
            <span>Queue</span>
          </Link>
        )}
        {(['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE'] as string[]).includes(role) && (
          <Link
            href="/pms"
            className="flex flex-col items-center gap-1 text-slate-400 hover:text-white"
          >
            <Calendar className="w-4 h-4 text-emerald-400" />
            <span>PMS</span>
          </Link>
        )}
        {(['SUPER_ADMIN', 'BUDGET_OFFICER', 'ACCOUNTING', 'FRONT_DESK'] as string[]).includes(role) && (
          <Link
            href="/transmittals/create"
            className="flex flex-col items-center gap-1 text-slate-400 hover:text-white"
          >
            <Send className="w-4 h-4 text-emerald-400" />
            <span>Trans</span>
          </Link>
        )}
      </nav>
    </div>
  )
}
