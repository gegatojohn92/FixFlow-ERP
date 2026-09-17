import type { AuditEventRow } from '@/lib/audit/audit-types'
import { AuditEventMetadata } from './AuditEventMetadata'

export function AuditLogDetail({ events }: { events: AuditEventRow[] }) {
  if (events.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-sm text-slate-400">No history is available for this record in your authorized scope.</div>
  }

  return (
    <ol className="space-y-4">
      {events.map(event => (
        <li key={event.id} className="relative rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-sm font-bold text-cyan-300">{event.action}</p>
              <p className="mt-1 text-xs text-slate-400">{event.actor_name ?? 'System'} · {event.actor_role ?? 'SYSTEM'}{event.actor_department_name ? ` · ${event.actor_department_name}` : ''}</p>
            </div>
            <time className="text-xs text-slate-500">{new Date(event.occurred_at).toLocaleString()}</time>
          </div>
          {(event.previous_state || event.resulting_state) && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg bg-slate-950 p-3"><p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Previous state</p><AuditEventMetadata value={event.previous_state} /></div>
              <div className="rounded-lg bg-slate-950 p-3"><p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Resulting state</p><AuditEventMetadata value={event.resulting_state} /></div>
            </div>
          )}
          <div className="mt-4 rounded-lg bg-slate-950 p-3"><p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Event metadata</p><AuditEventMetadata value={event.metadata} /></div>
        </li>
      ))}
    </ol>
  )
}
