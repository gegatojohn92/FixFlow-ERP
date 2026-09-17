import Link from 'next/link'
import type { AuditEventRow } from '@/lib/audit/audit-types'

export function AuditLogTable({ events }: { events: AuditEventRow[] }) {
  if (events.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-sm text-slate-400">No audit events match the current scope and filters.</div>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
      <table className="min-w-[900px] w-full text-left text-xs">
        <thead className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-3">When</th>
            <th className="px-4 py-3">Actor</th>
            <th className="px-4 py-3">Action</th>
            <th className="px-4 py-3">Record</th>
            <th className="px-4 py-3">Reference</th>
            <th className="px-4 py-3">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {events.map(event => (
            <tr key={event.id} className="align-top hover:bg-slate-800/50">
              <td className="whitespace-nowrap px-4 py-3 text-slate-400">{new Date(event.occurred_at).toLocaleString()}</td>
              <td className="px-4 py-3"><span className="font-semibold text-slate-200">{event.actor_name ?? 'System'}</span><span className="mt-1 block text-[10px] text-slate-500">{event.actor_role ?? 'SYSTEM'}{event.actor_department_name ? ` / ${event.actor_department_name}` : ''}</span></td>
              <td className="px-4 py-3 font-mono text-cyan-300">{event.action}</td>
              <td className="px-4 py-3"><Link href={`/audit-logs/${event.entity_type}/${event.entity_id}`} className="text-blue-300 hover:text-blue-200">{event.entity_type} #{event.entity_id}</Link></td>
              <td className="px-4 py-3 text-slate-300">{event.reference_code ?? '-'}</td>
              <td className="max-w-[240px] px-4 py-3 text-slate-400">{event.metadata && Object.keys(event.metadata).length > 0 ? JSON.stringify(event.metadata) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
