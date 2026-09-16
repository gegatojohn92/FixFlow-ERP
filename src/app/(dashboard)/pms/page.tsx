import React from 'react'
import Link from 'next/link'
import { Calendar, Wind, ArrowRight, Wrench } from 'lucide-react'

export default function PMSIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            Preventive Maintenance System
          </h1>
          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-950 text-emerald-400 border border-emerald-900">
            PMS
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Select a maintenance category to view the asset queue and execute checklists.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-2xl">
        {/* Form 15 — General PMS */}
        <Link
          href="/pms/daily"
          className="group relative flex flex-col gap-4 p-6 bg-slate-900 border border-slate-800 rounded-2xl hover:border-emerald-700/60 hover:bg-slate-900/90 transition-all shadow-lg"
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-xl bg-emerald-600/20 border border-emerald-700/40 flex items-center justify-center group-hover:bg-emerald-600/30 transition-colors">
              <Wrench className="w-5 h-5 text-emerald-400" />
            </div>
            <span className="text-[10px] font-bold text-emerald-500/70 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-900/60">
              FORM 15
            </span>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">Equipment & Facility PMS</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              HVAC, Plumbing, Electrical, Kitchen Equipment, Structural, and General assets.
              Execute checklists and reset service intervals.
            </p>
          </div>

          <div className="flex items-center gap-1 text-xs text-emerald-400 font-semibold mt-auto">
            Open PMS Queue <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        {/* Form 16 — Aircon PMS */}
        <Link
          href="/pms/aircon"
          className="group relative flex flex-col gap-4 p-6 bg-slate-900 border border-slate-800 rounded-2xl hover:border-blue-700/60 hover:bg-slate-900/90 transition-all shadow-lg"
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-xl bg-blue-600/20 border border-blue-700/40 flex items-center justify-center group-hover:bg-blue-600/30 transition-colors">
              <Wind className="w-5 h-5 text-blue-400" />
            </div>
            <span className="text-[10px] font-bold text-blue-500/70 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-900/60">
              FORM 16
            </span>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">Aircon 3-Month Service</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Dedicated aircon service grid with freon pressure (PSI), compressor amperage,
              and photo documentation per unit.
            </p>
          </div>

          <div className="flex items-center gap-1 text-xs text-blue-400 font-semibold mt-auto">
            Open Aircon Grid <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>
      </div>

      {/* Info Panel */}
      <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl text-xs text-slate-400 max-w-2xl space-y-1 leading-relaxed">
        <div className="flex items-center gap-2 text-slate-300 font-semibold mb-2">
          <Calendar className="w-4 h-4 text-emerald-400" />
          <span>PMS Scheduling Rules</span>
        </div>
        <p>• <b className="text-slate-300">Daily/Weekly/Monthly/Yearly</b> — computed automatically from completion date.</p>
        <p>• <b className="text-slate-300">Custom Months</b> — specify interval in months when creating/editing assets.</p>
        <p>• <b className="text-slate-300">Aircon</b> — always resets to 3-month cycle; additional freon/amperage data required.</p>
        <p>• Assets appear in the queue when <b className="text-slate-300">next_due_date ≤ today</b>.</p>
      </div>
    </div>
  )
}
