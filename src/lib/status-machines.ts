/**
 * status-machines.ts — Canonical JO / MRS state machines and role gates.
 *
 * Single source of truth shared by:
 *   - Server Actions (early, human-readable validation before hitting the DB)
 *   - Client pages (deciding which action buttons to render)
 *
 * IMPORTANT: These maps must mirror the database transition guards in
 * `supabase/migrations/0004_cascade_triggers.sql` and
 * `supabase/migrations/0011_jo_mrs_flow_enhancements.sql`. The DB triggers
 * remain the final line of defense; this module fails fast with clear errors.
 */

import type { JOStatus, MRSStatus, UserRole } from '@/types/index'

// ──────────────────────────────────────────────────────────
// JO transitions (Plan §4.1 + 0011 enhancements)
// ──────────────────────────────────────────────────────────
export const JO_TRANSITIONS: Record<JOStatus, readonly JOStatus[]> = {
  PENDING_ASSESSMENT: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_MRS_APPROVAL', 'COMPLETED', 'CANCELLED', 'MRS_REJECTED', 'MATERIALS_RECEIVED'],
  AWAITING_MRS_APPROVAL: ['IN_PROGRESS', 'MATERIALS_RECEIVED', 'CANCELLED', 'MRS_REJECTED'],
  MRS_REJECTED: ['IN_PROGRESS', 'AWAITING_MRS_APPROVAL'],
  COMPLETED: ['MATERIALS_RECEIVED', 'REOPENED_UNRESOLVED', 'CRITICAL_REOPEN_ESCALATED', 'CLOSED'],
  REOPENED_UNRESOLVED: ['COMPLETED'],
  CRITICAL_REOPEN_ESCALATED: ['COMPLETED'],
  MATERIALS_RECEIVED: ['COMPLETED', 'CLOSED'],
  CANCELLED: [],
  CLOSED: [],
}

// ──────────────────────────────────────────────────────────
// MRS transitions (Plan §4.2 + 0011 enhancements)
// ──────────────────────────────────────────────────────────
export const MRS_TRANSITIONS: Record<MRSStatus, readonly MRSStatus[]> = {
  PENDING_MANAGER: ['MANAGER_REJECTED', 'IN_CANVASSING', 'ISSUED_FROM_STOCK', 'VOIDED'],
  MANAGER_REJECTED: ['PENDING_MANAGER', 'VOIDED'],
  IN_CANVASSING: ['PENDING_OWNER', 'VOIDED'],
  PENDING_OWNER: ['OWNER_REJECTED', 'APPROVED_READY_TO_ORDER', 'VOIDED'],
  OWNER_REJECTED: ['PENDING_MANAGER', 'VOIDED'],
  APPROVED_READY_TO_ORDER: ['TRANSMITTAL_IN_PROGRESS', 'READY_FOR_PURCHASE', 'PURCHASING', 'IN_TRANSIT', 'VOIDED'],
  TRANSMITTAL_IN_PROGRESS: ['READY_FOR_PURCHASE', 'PURCHASING', 'VOIDED'],
  READY_FOR_PURCHASE: ['PURCHASING', 'IN_TRANSIT', 'VOIDED'],
  PURCHASING: ['PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'FULFILLED', 'IN_TRANSIT', 'VOIDED'],
  PARTIALLY_FULFILLED_BUDGET_EXHAUSTED: ['FULFILLED', 'VOIDED'],
  EMERGENCY_FAST_TRACK: ['PURCHASING', 'FULFILLED', 'VOIDED'],
  FULFILLED: ['DISPUTED', 'CLOSED'],
  DISPUTED: ['FULFILLED'],
  IN_TRANSIT: ['FULFILLED', 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'DISPUTED', 'VOIDED'],
  ISSUED_FROM_STOCK: ['VOIDED'],
  VOIDED: [],
  CLOSED: [],
}

export function canTransitionJO(from: JOStatus, to: JOStatus): boolean {
  return (JO_TRANSITIONS[from] ?? []).includes(to)
}

export function canTransitionMRS(from: MRSStatus, to: MRSStatus): boolean {
  return (MRS_TRANSITIONS[from] ?? []).includes(to)
}

/** Throws a readable error when a JO transition is illegal (for server actions). */
export function assertJOTransition(from: JOStatus, to: JOStatus, joNumber?: string): void {
  if (!canTransitionJO(from, to)) {
    throw new Error(
      `Illegal Job Order transition from "${from}" to "${to}"${joNumber ? ` (${joNumber})` : ''}. ` +
      `Allowed next states: ${(JO_TRANSITIONS[from] ?? []).join(', ') || 'none (terminal state)'}.`
    )
  }
}

/** Throws a readable error when a MRS transition is illegal (for server actions). */
export function assertMRSTransition(from: MRSStatus, to: MRSStatus, mrsNumber?: string): void {
  if (!canTransitionMRS(from, to)) {
    throw new Error(
      `Illegal requisition transition from "${from}" to "${to}"${mrsNumber ? ` (${mrsNumber})` : ''}. ` +
      `Allowed next states: ${(MRS_TRANSITIONS[from] ?? []).join(', ') || 'none (terminal state)'}.`
    )
  }
}

// ──────────────────────────────────────────────────────────
// Action eligibility (which statuses allow which user actions)
// ──────────────────────────────────────────────────────────

/** Form 2 — Cancel Request (Plan §0.7). */
export const CANCELLABLE_JO_STATUSES: readonly JOStatus[] = [
  'PENDING_ASSESSMENT',
  'IN_PROGRESS',
  'AWAITING_MRS_APPROVAL',
]

/** Form 3 — Mark Done (Plan §5 Form 3). Includes MATERIALS_RECEIVED (0011). */
export const COMPLETABLE_JO_STATUSES: readonly JOStatus[] = [
  'IN_PROGRESS',
  'REOPENED_UNRESOLVED',
  'CRITICAL_REOPEN_ESCALATED',
  'MATERIALS_RECEIVED',
]

/** Final acceptance close — Manager / Super Admin only (0011). */
export const CLOSEABLE_JO_STATUSES: readonly JOStatus[] = ['COMPLETED', 'MATERIALS_RECEIVED']

/** Form 3 — Accept Request (Plan §5 Form 3). */
export const ACCEPTABLE_JO_STATUSES: readonly JOStatus[] = ['PENDING_ASSESSMENT']

/** Form 2 — Issue Still Persists / Reopen (Plan §0.10). */
export const REOPENABLE_JO_STATUSES: readonly JOStatus[] = ['COMPLETED']

/** Form 5 — JOs that may receive a linked MRS. */
export const JO_STATUSES_FOR_MRS_LINK: readonly JOStatus[] = [
  'PENDING_ASSESSMENT',
  'IN_PROGRESS',
  'AWAITING_MRS_APPROVAL',
  'MRS_REJECTED',
]

/** Form 3 — statuses shown in the Technician Queue. */
export const ACTIVE_JO_QUEUE_STATUSES: readonly JOStatus[] = [
  'PENDING_ASSESSMENT',
  'IN_PROGRESS',
  'AWAITING_MRS_APPROVAL',
  'MRS_REJECTED',
  'REOPENED_UNRESOLVED',
  'MATERIALS_RECEIVED',
]

/** Form 13 — Confirm Cash (0011: fast-track now included, was broken). */
export const PURCHASER_CONFIRM_CASH_STATUSES: readonly MRSStatus[] = [
  'APPROVED_READY_TO_ORDER',
  'TRANSMITTAL_IN_PROGRESS',
  'READY_FOR_PURCHASE',
  'EMERGENCY_FAST_TRACK',
]

/** Form 13 — Mark In Transit for online / COD orders (0011: wires IN_TRANSIT). */
export const MRS_STATUSES_FOR_IN_TRANSIT: readonly MRSStatus[] = [
  'APPROVED_READY_TO_ORDER',
  'READY_FOR_PURCHASE',
  'PURCHASING',
]

/** Form 14 — Requester delivery sign-off queue. */
export const DELIVERY_VERIFY_STATUSES: readonly MRSStatus[] = [
  'FULFILLED',
  'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED',
  'DISPUTED',
  'IN_TRANSIT',
]

/** Form 6 — Storekeeper stock check queue. */
export const STOCK_CHECK_STATUSES: readonly MRSStatus[] = ['PENDING_MANAGER']

/** Form 7 — Manager approval queue. */
export const MANAGER_REVIEW_STATUSES: readonly MRSStatus[] = ['PENDING_MANAGER']

/** Form 8 — Canvass workspace queue. */
export const CANVASS_STATUSES: readonly MRSStatus[] = ['IN_CANVASSING', 'PENDING_OWNER']

// ──────────────────────────────────────────────────────────
// Role gates
// ──────────────────────────────────────────────────────────

/** Roles allowed to final-close a Job Order. */
export const JO_CLOSE_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'MANAGER']

/** Roles allowed to mark a MRS in transit (Form 13 online orders). */
export const MRS_IN_TRANSIT_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'PURCHASER']

// ──────────────────────────────────────────────────────────
// Business constants (defaults mirrored by system_settings seeds)
// ──────────────────────────────────────────────────────────

/** Departments eligible for Emergency Fast-Track (Plan §6.A). */
export const FAST_TRACK_ALLOWED_DEPTS = ['kitchen', 'f&b', 'housekeeping', 'maintenance']

/** Fallback when get_setting_numeric() is unavailable (pre-0011 deployments). */
export const FAST_TRACK_CAP_DEFAULT = 3000.0
export const MINOR_DEFICIT_AMOUNT_DEFAULT = 200.0
export const MINOR_DEFICIT_PERCENT_DEFAULT = 5
export const BATCH_TRANSMITTAL_MAX_ITEMS = 50
