'use server'

import { createClient } from '@/lib/supabase/server'
import { getAuditHistory, listAuditEvents, recordAuditEvent } from '@/lib/audit/audit-service'
import { canExportAudit, normalizeAuditFilters } from '@/lib/audit/audit-visibility'
import type { AuditEventInput, AuditLogFilters } from '@/lib/audit/audit-types'
import type { UserRole } from '@/types/index'

async function requireAuditRole() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Authentication required.')

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('role, account_status')
    .eq('id', user.id)
    .single()
  if (profileError || !profile || profile.account_status !== 'ACTIVE') {
    throw new Error('An active user profile is required.')
  }
  return { supabase, user, role: profile.role as UserRole }
}

export async function getAuditViewer() {
  const { role } = await requireAuditRole()
  return { role, canExport: canExportAudit(role) }
}

export async function listAuditLog(filters: AuditLogFilters = {}) {
  await requireAuditRole()
  return listAuditEvents(normalizeAuditFilters(filters))
}

export async function getAuditRecordHistory(entityType: AuditEventInput['entityType'], entityId: number) {
  await requireAuditRole()
  if (!Number.isInteger(entityId) || entityId < 0) throw new Error('Invalid audit record id.')
  return getAuditHistory(entityType, entityId)
}

function csvCell(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

export async function exportAuditLog(filters: AuditLogFilters = {}) {
  const { user, role } = await requireAuditRole()
  if (!canExportAudit(role)) throw new Error('Only Managers and Super Admins can export audit logs.')

  const normalized = normalizeAuditFilters({ ...filters, page: 1, pageSize: 100 })
  const result = await listAuditEvents(normalized)
  const header = [
    'occurred_at', 'actor_name', 'actor_role', 'actor_department',
    'entity_type', 'entity_id', 'entity_department_id', 'reference_code',
    'action', 'previous_state', 'resulting_state', 'metadata', 'correlation_id',
  ]
  const rows = result.events.map(event => [
    event.occurred_at,
    event.actor_name,
    event.actor_role,
    event.actor_department_name,
    event.entity_type,
    event.entity_id,
    event.entity_department_id,
    event.reference_code,
    event.action,
    event.previous_state,
    event.resulting_state,
    event.metadata,
    event.correlation_id,
  ].map(csvCell).join(','))

  await recordAuditEvent({
    entityType: 'system',
    entityId: 0,
    action: 'AUDIT_EXPORT',
    metadata: {
      exporting_user_id: user.id,
      row_count: result.events.length,
      filters: normalized as unknown as Record<string, never>,
    },
  })

  return {
    filename: `fixflow-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: [header.join(','), ...rows].join('\n'),
    rowCount: result.events.length,
  }
}
