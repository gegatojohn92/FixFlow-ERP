import type { UserRole } from '@/types/index'
import { AUDIT_EXPORT_ROLES, type AuditLogFilters } from './audit-types'

export function canExportAudit(role: UserRole): boolean {
  return AUDIT_EXPORT_ROLES.includes(role)
}

export function normalizeAuditFilters(filters: AuditLogFilters = {}): AuditLogFilters {
  return {
    ...filters,
    page: Math.max(filters.page ?? 1, 1),
    pageSize: Math.min(Math.max(filters.pageSize ?? 25, 1), 100),
    referenceCode: filters.referenceCode?.trim() || undefined,
  }
}

export function canViewAuditRoute(role: UserRole): boolean {
  return Boolean(role)
}
