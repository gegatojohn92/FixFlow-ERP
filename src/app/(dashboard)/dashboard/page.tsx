import React from 'react'
import Link from 'next/link'
import {
  Wrench,
  Clock,
  CheckCircle2,
  AlertOctagon,
  PlusCircle,
  FileCheck,
  Calendar,
  ArrowRight,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()

  // Fetch count of active Job Orders
  const { count: pendingCount } = await supabase
    .from('job_orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'PENDING_ASSESSMENT')

  const { count: inProgressCount } = await supabase
    .from('job_orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'IN_PROGRESS')

  const { count: escalatedCount } = await supabase
    .from('job_orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'CRITICAL_REOPEN_ESCALATED')

  const { count: completedCount } = await supabase
    .from('job_orders')
    .select('*', { count: 'exact', head: true })
    .in('status', ['COMPLETED', 'CLOSED'])

  // Fetch recent Job Orders
  const { data: recentJOs } = await supabase
    .from('job_orders')
    .select('id, jo_number, revision_suffix, title, priority, status, created_at, location')
    .order('created_at', { ascending: false })
    .limit(5)

  // Fetch upcoming PMS due assets
  const today = new Date().toISOString().split('T')[0]
  const { data: dueAssets } = await supabase
    .from('pms_assets')
    .select('id, asset_name, category, location, next_due_date, is_aircon')
    .lte('next_due_date', today)
    .limit(4)

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-blue-950/60 via-slate-900 to-slate-900 p-6 rounded-2xl border border-blue-900/40">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            Operational Dashboard
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Real-time status of job orders, maintenance queues, and asset upkeep schedules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/jo/new"
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/30 transition-all"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create Job Order (Form 1)</span>
          </Link>
        </div>
      </div>

      {/* Metrics Counter Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Pending Assessment */}
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-amber-400">
            <span className="text-xs font-semibold text-slate-400">Pending Assessment</span>
            <Clock className="w-4 h-4" />
          </div>
          <p className="text-2xl sm:text-3xl font-black font-mono text-white">
            {pendingCount ?? 0}
          </p>
          <span className="text-[11px] text-slate-400">Awaiting technician pick-up</span>
        </div>

        {/* In Progress */}
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-blue-400">
            <span className="text-xs font-semibold text-slate-400">In Progress</span>
            <Wrench className="w-4 h-4" />
          </div>
          <p className="text-2xl sm:text-3xl font-black font-mono text-white">
            {inProgressCount ?? 0}
          </p>
          <span className="text-[11px] text-slate-400">Technician active timer</span>
        </div>

        {/* Critical Escalations */}
        <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-900/50 space-y-2">
          <div className="flex items-center justify-between text-rose-400">
            <span className="text-xs font-semibold text-rose-300">Critical Escalated</span>
            <AlertOctagon className="w-4 h-4" />
          </div>
          <p className="text-2xl sm:text-3xl font-black font-mono text-rose-300">
            {escalatedCount ?? 0}
          </p>
          <span className="text-[11px] text-rose-400/80">Reopened ≥ 2 times (Form 4)</span>
        </div>

        {/* Completed / Closed */}
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-emerald-400">
            <span className="text-xs font-semibold text-slate-400">Completed & Closed</span>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <p className="text-2xl sm:text-3xl font-black font-mono text-white">
            {completedCount ?? 0}
          </p>
          <span className="text-[11px] text-slate-400">Fully resolved</span>
        </div>
      </div>

      {/* Main Grid: Recent JOs + PMS Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Job Orders List */}
        <div className="lg:col-span-2 space-y-3 bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <FileCheck className="w-4 h-4 text-blue-400" />
              <span>Recent Job Orders</span>
            </div>
            <Link
              href="/jo/track"
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium"
            >
              <span>View All</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="divide-y divide-slate-800/60">
            {recentJOs && recentJOs.length > 0 ? (
              recentJOs.map((jo) => {
                const code = jo.revision_suffix && jo.revision_suffix > 0
                  ? `${jo.jo_number}-${String(jo.revision_suffix).padStart(2, '0')}`
                  : jo.jo_number

                return (
                  <div key={jo.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-400">
                          {code}
                        </span>
                        {jo.priority === 'EMERGENCY' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-400 border border-rose-800">
                            EMERGENCY
                          </span>
                        )}
                        {jo.priority === 'URGENT' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-400 border border-amber-800">
                            URGENT
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-medium text-slate-200 truncate">{jo.title}</p>
                      <p className="text-[11px] text-slate-400">{jo.location}</p>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="px-2 py-1 rounded-md text-[10px] font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700 block">
                        {jo.status}
                      </span>
                      <Link
                        href={`/jo/track?id=${jo.id}`}
                        className="text-[10px] text-blue-400 hover:underline mt-1 inline-block"
                      >
                        Track →
                      </Link>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="py-8 text-center text-xs text-slate-500">
                No job orders submitted yet. Click &quot;Create Job Order&quot; to begin.
              </div>
            )}
          </div>
        </div>

        {/* PMS Overdue & Upcoming Alerts */}
        <div className="space-y-3 bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <span>PMS Due Assets</span>
            </div>
            <Link
              href="/pms"
              className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium"
            >
              <span>PMS Grid</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="space-y-2.5">
            {dueAssets && dueAssets.length > 0 ? (
              dueAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 truncate">
                      {asset.asset_name}
                    </span>
                    {asset.is_aircon && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                        AIRCON
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{asset.location}</span>
                    <span className="font-mono text-rose-400 font-semibold">
                      Due: {asset.next_due_date}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-xs text-slate-500">
                No maintenance tasks due today. All assets are current.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
