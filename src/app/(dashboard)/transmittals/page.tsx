import React from 'react'
import Link from 'next/link'
import {
  Send,
  Banknote,
  Building2,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react'
import { createClient, getServerUser } from '@/lib/supabase/server'
import { canViewRoute } from '@/lib/access-control'
import type { UserRole } from '@/types/index'

export default async function TransmittalsHubPage() {
  const supabase = await createClient()
  // getServerUser() never throws: an expired/rotated session or a transient
  // network failure resolves to null ("signed out") and the hub renders with
  // restricted tiles, instead of crashing the Server Component render
  // (production: the opaque "Minified React error #441"). See §8 of the
  // handoff — never call supabase.auth.getUser() directly in a Server Component.
  const user = await getServerUser()

  let userRole = 'STAFF'
  if (user) {
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
    if (profile?.role) userRole = profile.role
  }

  const canCreate = canViewRoute(userRole as UserRole, '/transmittals/create')
  const canAccounting = canViewRoute(userRole as UserRole, '/transmittals/accounting')
  const canFrontDesk = canViewRoute(userRole as UserRole, '/transmittals/front-desk')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Financial Transmittals
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-950 text-emerald-400 border border-emerald-900">
              CASH CHAIN
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Dual-confirmation ledger tracking all physical and online cash disbursements, revolving floats, and spare change returns.
          </p>
        </div>

        {canCreate && (
          <Link
            href="/transmittals/create"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 transition-all shrink-0"
          >
            <Send className="w-4 h-4" />
            Create Transmittal
          </Link>
        )}
      </div>

      {/* Grid of Forms */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Form 10 — Create Transmittal */}
        <Link
          href="/transmittals/create"
          className={`group relative flex flex-col gap-4 p-6 bg-slate-900 border rounded-2xl transition-all shadow-lg ${
            canCreate
              ? 'border-slate-800 hover:border-emerald-700/60 hover:bg-slate-900/90'
              : 'border-slate-800/60 opacity-60 pointer-events-none'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-xl bg-emerald-600/20 border border-emerald-700/40 flex items-center justify-center group-hover:bg-emerald-600/30 transition-colors">
              <Send className="w-5 h-5 text-emerald-400" />
            </div>
            <span className="text-[10px] font-bold text-emerald-500/80 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-900/60">
              FORM 10
            </span>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">Create Transmittal</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Budget Officer handoff. Issue single or batch transmittals (up to 50 MRS) for cash disbursements, floats, or returns.
            </p>
          </div>

          <div className="flex items-center gap-1 text-xs text-emerald-400 font-semibold mt-auto">
            {canCreate ? 'Open Form 10' : 'Restricted (Budget Officer)'}{' '}
            {canCreate && <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition-transform" />}
          </div>
        </Link>

        {/* Form 11 — Accounting Verification */}
        <Link
          href="/transmittals/accounting"
          className={`group relative flex flex-col gap-4 p-6 bg-slate-900 border rounded-2xl transition-all shadow-lg ${
            canAccounting
              ? 'border-slate-800 hover:border-violet-700/60 hover:bg-slate-900/90'
              : 'border-slate-800/60 opacity-60 pointer-events-none'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-xl bg-violet-600/20 border border-violet-700/40 flex items-center justify-center group-hover:bg-violet-600/30 transition-colors">
              <Banknote className="w-5 h-5 text-violet-400" />
            </div>
            <span className="text-[10px] font-bold text-violet-500/80 bg-violet-950/60 px-2 py-0.5 rounded border border-violet-900/60">
              FORM 11
            </span>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">Accounting Verification</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Accounting queue. Review pending transmittals, verify cash disbursement amounts, and confirm fund release.
            </p>
          </div>

          <div className="flex items-center gap-1 text-xs text-violet-400 font-semibold mt-auto">
            {canAccounting ? 'Open Accounting Queue' : 'Restricted (Accounting)'}{' '}
            {canAccounting && <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition-transform" />}
          </div>
        </Link>

        {/* Form 12 — Front Desk Acknowledgement */}
        <Link
          href="/transmittals/front-desk"
          className={`group relative flex flex-col gap-4 p-6 bg-slate-900 border rounded-2xl transition-all shadow-lg ${
            canFrontDesk
              ? 'border-slate-800 hover:border-blue-700/60 hover:bg-slate-900/90'
              : 'border-slate-800/60 opacity-60 pointer-events-none'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-xl bg-blue-600/20 border border-blue-700/40 flex items-center justify-center group-hover:bg-blue-600/30 transition-colors">
              <Building2 className="w-5 h-5 text-blue-400" />
            </div>
            <span className="text-[10px] font-bold text-blue-500/80 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-900/60">
              FORM 12
            </span>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">Front Desk Transmittals</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Online COD advances, barcode confirmation upon package arrival, and revolving float replenishment handoffs.
            </p>
          </div>

          <div className="flex items-center gap-1 text-xs text-blue-400 font-semibold mt-auto">
            {canFrontDesk ? 'Open Front Desk Queue' : 'Restricted (Front Desk)'}{' '}
            {canFrontDesk && <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition-transform" />}
          </div>
        </Link>
      </div>

      {/* Chain-of-Custody Guide */}
      <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-2xl text-xs text-slate-400 max-w-3xl space-y-2 leading-relaxed">
        <div className="flex items-center gap-2 text-slate-300 font-semibold mb-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>4-Step Chain-of-Custody Rules (Plan.md §4.3)</span>
        </div>
        <p>• <b className="text-slate-300">Form 10 (Create):</b> Budget Officer creates transmittal linking approved MRS items.</p>
        <p>• <b className="text-slate-300">Form 11 (Accounting Release):</b> Accounting verifies receipts/budget and releases funds.</p>
        <p>• <b className="text-slate-300">Form 12 (Front Desk / Receiver):</b> Designated receiver confirms receipt; MRS transitions to <span className="text-emerald-400 font-semibold">PURCHASING</span>.</p>
        <p>• <b className="text-slate-300">Dual-Signoff Required:</b> Both sender and receiver digital stamps are logged before status reaches <span className="text-emerald-400 font-semibold">RECEIVED</span>.</p>
      </div>
    </div>
  )
}
