import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { AuditExportButton } from '@/components/audit/AuditExportButton'
import { AuditLogFilters } from '@/components/audit/AuditLogFilters'
import { AuditLogTable } from '@/components/audit/AuditLogTable'
import { getAuditViewer, listAuditLog } from '@/lib/actions/audit-actions'
import { isAuditAction, isAuditEntityType, type AuditLogFilters as AuditFilters } from '@/lib/audit/audit-types'

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const entityTypeValue = valueOf(params.entityType)
  const actionValue = valueOf(params.action)
  const filters: AuditFilters = {
    entityType: entityTypeValue && isAuditEntityType(entityTypeValue) ? entityTypeValue : undefined,
    action: actionValue && isAuditAction(actionValue) ? actionValue : undefined,
    referenceCode: valueOf(params.referenceCode),
    from: valueOf(params.from),
    to: valueOf(params.to),
    page: Number(valueOf(params.page) ?? 1) || 1,
    pageSize: 25,
  }
  const [{ events, total, page, pageSize }, viewer] = await Promise.all([
    listAuditLog(filters),
    getAuditViewer(),
  ])
  const pageCount = Math.max(Math.ceil(total / pageSize), 1)
  const previousPage = page > 1 ? page - 1 : null
  const nextPage = page < pageCount ? page + 1 : null
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    const item = valueOf(value)
    if (item && key !== 'page') query.set(key, item)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><ClipboardList className="h-6 w-6 text-cyan-400" /><div><h1 className="text-xl font-black text-white">Audit Logs</h1><p className="text-xs text-slate-400">Authorized business history across workflow records.</p></div></div>
        {viewer.canExport && <AuditExportButton filters={filters} />}
      </header>
      <AuditLogFilters entityType={filters.entityType} action={filters.action} referenceCode={filters.referenceCode} from={filters.from} to={filters.to} />
      <AuditLogTable events={events} />
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>Page {page} of {pageCount} · {total} authorized events</span>
        <div className="flex gap-2">
          {previousPage ? <Link href={`/audit-logs?${query.toString()}&page=${previousPage}`} className="rounded-lg border border-slate-700 px-3 py-2 hover:bg-slate-800">Previous</Link> : <span className="rounded-lg border border-slate-800 px-3 py-2 text-slate-600">Previous</span>}
          {nextPage ? <Link href={`/audit-logs?${query.toString()}&page=${nextPage}`} className="rounded-lg border border-slate-700 px-3 py-2 hover:bg-slate-800">Next</Link> : <span className="rounded-lg border border-slate-800 px-3 py-2 text-slate-600">Next</span>}
        </div>
      </div>
    </div>
  )
}
