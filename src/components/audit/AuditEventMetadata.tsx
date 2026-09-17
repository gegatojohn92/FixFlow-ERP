import type { AuditJsonValue } from '@/lib/audit/audit-types'

export function AuditEventMetadata({ value }: { value: AuditJsonValue | null }) {
  if (value === null) return <span className="text-slate-500">None</span>
  return (
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-300">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
