import type { AuditAction, AuditEntityType } from '@/lib/audit/audit-types'
import Link from 'next/link'

export function AuditLogFilters({
  entityType,
  action,
  referenceCode,
  from,
  to,
}: {
  entityType?: AuditEntityType
  action?: AuditAction
  referenceCode?: string
  from?: string
  to?: string
}) {
  return (
    <form method="get" className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-xs text-slate-400">
        Entity
        <select name="entityType" defaultValue={entityType ?? ''} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">
          <option value="">All entities</option>
          <option value="job_order">Job Orders</option>
          <option value="material_requisition">MRS</option>
          <option value="transmittal_form">Transmittals</option>
          <option value="pms_asset">PMS Assets</option>
          <option value="user">Users</option>
        </select>
      </label>
      <label className="text-xs text-slate-400">
        Action
        <input name="action" defaultValue={action ?? ''} placeholder="MRS_CREATED" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200" />
      </label>
      <label className="text-xs text-slate-400">
        Reference
        <input name="referenceCode" defaultValue={referenceCode ?? ''} placeholder="MRS-2026" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200" />
      </label>
      <label className="text-xs text-slate-400">
        From
        <input type="date" name="from" defaultValue={from ?? ''} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200" />
      </label>
      <label className="text-xs text-slate-400">
        To
        <input type="date" name="to" defaultValue={to ?? ''} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200" />
      </label>
      <div className="sm:col-span-2 lg:col-span-5 flex justify-end gap-2">
        <Link href="/audit-logs" className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Reset</Link>
        <button type="submit" className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500">Apply filters</button>
      </div>
    </form>
  )
}
