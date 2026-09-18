import type { UserRole } from '@/types/index'
import type { Json } from '@/types/database.types'

export const AUDIT_ENTITY_TYPES = [
  'job_order',
  'material_requisition',
  'mrs_line_item',
  'transmittal_form',
  'pms_asset',
  'pms_activity_log',
  'item_price_catalog',
  'user',
  'system',
] as const

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number]

export const AUDIT_ACTIONS = [
  'JOB_ORDER_CREATED',
  'JOB_ORDER_CANCELLED',
  'JOB_ORDER_REOPENED',
  'CRITICAL_ESCALATION',
  'JOB_ORDER_ACCEPTED',
  'JOB_ORDER_COMPLETED',
  'JOB_ORDER_CLOSED',
  'ESCALATION_REASSIGNED',
  'MRS_CREATED',
  'MRS_EMERGENCY_FAST_TRACK_CREATED',
  'MRS_STOCK_CHECK_PARTIAL',
  'MRS_ISSUED_FROM_STOCK_COMPLETE',
  'MRS_APPROVED_BY_MANAGER',
  'MRS_REJECTED_BY_MANAGER',
  'MRS_CANVASSED_PENDING_OWNER',
  'MRS_OWNER_APPROVED',
  'MRS_OWNER_REJECTED',
  'FAST_TRACK_POST_AUDIT_COMPLETED',
  'PURCHASER_CASH_CONFIRMED',
  'PURCHASER_TRIP_COMPLETED',
  'MRS_MARKED_IN_TRANSIT',
  'MRS_AVAILABILITY_REPORTED',
  'MRS_AVAILABILITY_DECISION',
  'MRS_SPARE_CHANGE_REQUIRED',
  'MRS_SPARE_CHANGE_RETURNED',
  'MRS_DELIVERY_VERIFIED',
  'MRS_DELIVERY_DISPUTED',
  'MRS_VOIDED_BY_CASCADE',
  'TRANSMITTAL_CREATED',
  'BATCH_TRANSMITTAL_CREATED',
  'TRANSMITTAL_DISBURSED_SENT',
  'TRANSMITTAL_VERIFIED_RECEIVED',
  'TRANSMITTAL_CANCELLED_BY_CASCADE',
  'FD_COD_DISBURSEMENT',
  'FD_FLOAT_REPLENISHMENT',
  'PMS_CHECKLIST_COMPLETED',
  'AIRCON_SERVICE_COMPLETED',
  'PMS_ASSET_REGISTERED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DEACTIVATED',
  'USER_REACTIVATED',
  'USER_PASSWORD_RESET_REQUESTED',
  'AUDIT_EXPORT',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export type AuditJsonValue = Json

export type AuditMetadata = Record<string, AuditJsonValue>

export interface AuditEventInput {
  entityType: AuditEntityType
  entityId: number
  referenceCode?: string | null
  action: AuditAction
  entityDepartmentId?: number | null
  previousState?: AuditJsonValue
  resultingState?: AuditJsonValue
  metadata?: AuditMetadata
  correlationId?: string | null
  idempotencyKey?: string | null
}

export interface AuditEventRow {
  id: number
  occurred_at: string
  actor_user_id: string | null
  actor_name: string | null
  actor_role: UserRole | null
  actor_department_id: number | null
  actor_department_name: string | null
  entity_type: AuditEntityType
  entity_id: number
  entity_department_id: number | null
  reference_code: string | null
  action: AuditAction
  previous_state: AuditJsonValue | null
  resulting_state: AuditJsonValue | null
  metadata: AuditMetadata
  correlation_id: string | null
  idempotency_key: string | null
}

export interface AuditLogFilters {
  entityType?: AuditEntityType
  action?: AuditAction
  actorUserId?: string
  departmentId?: number
  referenceCode?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export const AUDIT_EXPORT_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'MANAGER']

export function isAuditEntityType(value: string): value is AuditEntityType {
  return (AUDIT_ENTITY_TYPES as readonly string[]).includes(value)
}

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value)
}
