import Link from 'next/link'
import { ArrowLeft, History } from 'lucide-react'
import { AuditLogDetail } from '@/components/audit/AuditLogDetail'
import { getAuditRecordHistory } from '@/lib/actions/audit-actions'
import { isAuditEntityType } from '@/lib/audit/audit-types'

export default async function AuditRecordHistoryPage({
  params,
}: {
  params: Promise<{ entityType: string; entityId: string }>
}) {
  const routeParams = await params
  if (!isAuditEntityType(routeParams.entityType)) throw new Error('Unknown audit entity type.')
  const entityId = Number(routeParams.entityId)
  if (!Number.isInteger(entityId) || entityId < 0) throw new Error('Invalid audit entity id.')
  const events = await getAuditRecordHistory(routeParams.entityType, entityId)

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-800 pb-4">
        <Link href="/audit-logs" className="mb-4 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Back to audit logs</Link>
        <div className="flex items-center gap-3"><History className="h-6 w-6 text-cyan-400" /><div><h1 className="text-xl font-black text-white">Record History</h1><p className="text-xs text-slate-400">{routeParams.entityType} #{entityId} · {events.length} authorized events</p></div></div>
      </header>
      <AuditLogDetail events={events} />
    </div>
  )
}
