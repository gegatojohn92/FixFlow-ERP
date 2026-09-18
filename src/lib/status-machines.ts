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
  // 0012 strict chain: owner approval MUST go through the transmittal —
  // no direct jump to purchase/in-transit without Form 10 + Form 11.
  APPROVED_READY_TO_ORDER: ['TRANSMITTAL_IN_PROGRESS', 'VOIDED'],
  // Only Accounting's disburse & mark-sent (Form 11) advances this.
  TRANSMITTAL_IN_PROGRESS: ['READY_FOR_PURCHASE', 'VOIDED'],
  // Only the purchaser's cash confirmation + float lock (Form 13) advances this.
  READY_FOR_PURCHASE: ['PURCHASING', 'VOIDED'],
  PURCHASING: ['PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'FULFILLED', 'IN_TRANSIT', 'VOIDED'],
  PARTIALLY_FULFILLED_BUDGET_EXHAUSTED: ['FULFILLED', 'DISPUTED', 'VOIDED'],
  // Fast-track (Plan §6.A) bypasses Forms 6-8-10: the purchase proceeds
  // directly, but actuals still flow through PURCHASING for online orders.
  EMERGENCY_FAST_TRACK: ['PURCHASING', 'FULFILLED', 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'VOIDED'],
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

/** Form field limits — mirror the database column sizes (Plan §3.2).
 *  Lives here (a plain module) because it is also imported by client
 *  pages, and 'use server' files may only export async functions. */
export const JO_FIELD_LIMITS = {
  title: 200,
  location: 150,
  description: 2000,
} as const

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

/** Form 13 — Confirm Cash & Lock Float (0012 strict chain:
 *  only after Accounting disbursed + marked the transmittal SENT —
 *  or the no-transmittal Emergency Fast-Track path). */
export const PURCHASER_CONFIRM_CASH_STATUSES: readonly MRSStatus[] = [
  'READY_FOR_PURCHASE',
  'EMERGENCY_FAST_TRACK',
]

/** Form 13 — Mark In Transit for online / COD orders (0012: only after
 *  cash was confirmed & the float locked — the order ships from PURCHASING). */
export const MRS_STATUSES_FOR_IN_TRANSIT: readonly MRSStatus[] = [
  'PURCHASING',
]

/** Form 13 — Save actuals & forward to delivery (0012 strict chain:
 *  in-store from PURCHASING, online/COD from IN_TRANSIT, or the direct
 *  Emergency Fast-Track purchase). Never before the cash gate. */
export const PURCHASER_COMPLETE_TRIP_STATUSES: readonly MRSStatus[] = [
  'PURCHASING',
  'IN_TRANSIT',
  'EMERGENCY_FAST_TRACK',
]

// ──────────────────────────────────────────────────────────
// 0013 — Partial availability loop (Form 13 → Form 9 → Form 13)
// ──────────────────────────────────────────────────────────

/**
 * The requester's answer to a purchaser's availability report.
 *   NONE             — no availability issue was ever reported
 *   PENDING          — purchaser reported a shortfall; awaiting the requester
 *   PROCEED_PARTIAL  — buy what is available, leave the balance outstanding
 *   WAIT_FULL        — hold the purchase until the full quantity is available
 *   CANCEL_REMAINING — buy what is available and cancel the balance
 */
export const REQUESTER_DECISIONS = [
  'NONE',
  'PENDING',
  'PROCEED_PARTIAL',
  'WAIT_FULL',
  'CANCEL_REMAINING',
] as const

export type RequesterDecision = (typeof REQUESTER_DECISIONS)[number]

/** Decisions that release the purchaser to buy the available quantity. */
export const DECISIONS_ALLOWING_PURCHASE: readonly RequesterDecision[] = [
  'NONE',
  'PROCEED_PARTIAL',
  'CANCEL_REMAINING',
]

/** Form 13 — statuses from which a purchaser may report item availability. */
export const AVAILABILITY_REPORT_STATUSES: readonly MRSStatus[] = [
  'PURCHASING',
  'EMERGENCY_FAST_TRACK',
]

/** Roles allowed to report a supply shortfall (Form 13). */
export const AVAILABILITY_REPORT_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'PURCHASER']

/** Human-readable label for each decision (shared by Form 9 and Form 13). */
export const REQUESTER_DECISION_LABELS: Record<RequesterDecision, string> = {
  NONE: 'No availability issue',
  PENDING: 'Awaiting requester decision',
  PROCEED_PARTIAL: 'Proceed with available quantity',
  WAIT_FULL: 'Wait for full availability',
  CANCEL_REMAINING: 'Buy available & cancel the balance',
}

/**
 * True when the requisition is frozen waiting for the requester to answer a
 * purchaser's availability report. Mirrors Gate A of migration 0013.
 */
export function isAwaitingRequesterDecision(mrs: {
  availability_hold?: boolean | null
  requester_decision?: string | null
}): boolean {
  return Boolean(mrs.availability_hold) && mrs.requester_decision === 'PENDING'
}

// ──────────────────────────────────────────────────────────
// 0013 — Spare-change reconciliation (Form 14 → Form 11/16)
// ──────────────────────────────────────────────────────────

/** Currency rounding tolerance shared by the app gates and SQL Gate B. */
export const SPARE_CHANGE_TOLERANCE = 0.01

/** Outstanding spare change still owed to Accounting (never negative). */
export function outstandingSpareChange(mrs: {
  spare_change_required?: number | null
  spare_change_returned?: number | null
}): number {
  const required = Number(mrs.spare_change_required ?? 0)
  const returned = Number(mrs.spare_change_returned ?? 0)
  const diff = required - returned
  return diff > SPARE_CHANGE_TOLERANCE ? Number(diff.toFixed(2)) : 0
}

/** Gate B: may Accounting close this requisition / transmittal? */
export function isSpareChangeSettled(mrs: {
  spare_change_required?: number | null
  spare_change_returned?: number | null
}): boolean {
  return outstandingSpareChange(mrs) === 0
}

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

/**
 * PostgreSQL "undefined_column" — PostgREST surfaces this when a migration
 * that adds a column has not been applied to the target project yet.
 * See Rule 7 in agent_handoff.md: a single unknown column in a `.select()`
 * fails the WHOLE query and silently returns no rows.
 */
export const PG_UNDEFINED_COLUMN = '42703'

/** Fields added by migration 0013 — absent until the SQL is applied. */
export interface MRS0013Fields {
  availability_hold: boolean
  availability_notes: string | null
  requester_decision: string
  requester_decision_notes: string | null
  spare_change_required: number
  spare_change_returned: number
}

/** Safe defaults so pre-0013 deployments behave exactly as they did before. */
export const MRS_0013_DEFAULTS: MRS0013Fields = {
  availability_hold: false,
  availability_notes: null,
  requester_decision: 'NONE',
  requester_decision_notes: null,
  spare_change_required: 0,
  spare_change_returned: 0,
}
