'use server'

/**
 * alert-actions.ts — "What needs MY attention right now?"
 *
 * Form 13's partial-availability loop requires that the requester is NOTIFIED
 * when the purchaser reports a shortfall. There is no notifications table and
 * no email/push transport in this deployment, so the notification is delivered
 * in-app: a live count on the header bell plus a list the user can click
 * straight through to the requisition that is waiting on them.
 *
 * Everything here is derived from current row state rather than stored, which
 * means an alert cannot go stale or be missed — once the underlying condition
 * clears, the alert disappears on the next read.
 */

import { createClient, getServerUser } from '@/lib/supabase/server'
import { PG_UNDEFINED_COLUMN } from '@/lib/status-machines'

export type AlertKind =
  | 'AVAILABILITY_DECISION'   // Form 9  — purchaser reported a shortfall, requester must decide
  | 'AVAILABILITY_ANSWERED'   // Form 13 — requester answered, purchaser may now buy
  | 'DELIVERY_SIGN_OFF'       // Form 14 — goods arrived, requester must sign off

export interface UserAlert {
  kind: AlertKind
  mrsId: number
  mrsNumber: string
  title: string
  detail: string
  href: string
}

export interface AlertsResult {
  alerts: UserAlert[]
  count: number
  /** True when migration 0013 is not applied — availability alerts are skipped. */
  degraded: boolean
}

const EMPTY: AlertsResult = { alerts: [], count: 0, degraded: false }

/**
 * Alerts addressed to the signed-in user.
 *
 * Never throws: this feeds a header widget, and a failure here must not take
 * down the dashboard shell. On any error it returns an empty set.
 */
export async function getMyAlerts(): Promise<AlertsResult> {
  try {
    const supabase = await createClient()
    const user = await getServerUser()
    if (!user) return EMPTY

    const { data: profile } = await supabase
      .from('users')
      .select('role, department_id, account_status')
      .eq('id', user.id)
      .single()

    if (!profile || profile.account_status !== 'ACTIVE') return EMPTY

    const role = profile.role as string
    const deptId = profile.department_id as number | null

    // The 0013 columns fail the WHOLE query with 42703 when the migration is
    // absent (Rule 7), so fall back to the pre-0013 set below.
    // NB: the column list must be an inline literal — hoisting it to a const
    // collapses PostgREST's typed overload to GenericStringError[].
    const query = await supabase
      .from('material_requisitions')
      .select(
        'id, mrs_number, department_id, overall_status, requester_verification, availability_hold, availability_notes, requester_decision'
      )
      .not('overall_status', 'in', '("CLOSED","VOIDED","MANAGER_REJECTED","OWNER_REJECTED")')

    if (query.error?.code === PG_UNDEFINED_COLUMN) {
      // Pre-0013: availability alerts cannot be computed. Delivery sign-off
      // still can, since requester_verification dates from 0001.
      const legacy = await supabase
        .from('material_requisitions')
        .select('id, mrs_number, department_id, overall_status, requester_verification')
        .not('overall_status', 'in', '("CLOSED","VOIDED","MANAGER_REJECTED","OWNER_REJECTED")')

      if (legacy.error || !legacy.data) return { ...EMPTY, degraded: true }
      return {
        ...buildAlerts(legacy.data as unknown as MRSAlertRow[], role, deptId),
        degraded: true,
      }
    }

    if (query.error || !query.data) return EMPTY

    return buildAlerts(query.data as unknown as MRSAlertRow[], role, deptId)
  } catch {
    return EMPTY
  }
}

interface MRSAlertRow {
  id: number
  mrs_number: string
  department_id: number | null
  overall_status: string
  requester_verification: string | null
  availability_hold?: boolean | null
  availability_notes?: string | null
  requester_decision?: string | null
}

function buildAlerts(
  rows: MRSAlertRow[],
  role: string,
  deptId: number | null
): AlertsResult {
  const alerts: UserAlert[] = []

  // Mirrors the server-side department rule used by Form 9 / Form 14: the
  // requester's own department decides and signs off; Super Admin sees all.
  const isMine = (row: MRSAlertRow) =>
    role === 'SUPER_ADMIN' || (deptId !== null && row.department_id === deptId)

  const isPurchaser = role === 'PURCHASER' || role === 'SUPER_ADMIN'

  for (const row of rows) {
    const onHold = Boolean(row.availability_hold)
    const decision = row.requester_decision ?? 'NONE'

    // ── Leg 2: purchaser reported a shortfall → requester must decide ───────
    if (onHold && decision === 'PENDING' && isMine(row)) {
      alerts.push({
        kind: 'AVAILABILITY_DECISION',
        mrsId: row.id,
        mrsNumber: row.mrs_number,
        title: `${row.mrs_number} — items unavailable`,
        detail:
          row.availability_notes?.trim() ||
          'The purchaser reported a supply shortfall. Choose how to proceed.',
        href: '/mrs',
      })
      continue
    }

    // ── Leg 3: requester answered → purchaser is released to buy ────────────
    // WAIT_FULL deliberately produces no alert: it does NOT release the
    // purchase, so surfacing it as actionable would invite a partial buy the
    // requester explicitly refused.
    if (
      isPurchaser &&
      !onHold &&
      (decision === 'PROCEED_PARTIAL' || decision === 'CANCEL_REMAINING') &&
      ['PURCHASING', 'EMERGENCY_FAST_TRACK'].includes(row.overall_status)
    ) {
      alerts.push({
        kind: 'AVAILABILITY_ANSWERED',
        mrsId: row.id,
        mrsNumber: row.mrs_number,
        title: `${row.mrs_number} — requester answered`,
        detail:
          decision === 'PROCEED_PARTIAL'
            ? 'Proceed with the available quantity, then save the actuals.'
            : 'Buy what is available and cancel the balance, then save the actuals.',
        href: '/purchaser/queue',
      })
      continue
    }

    // ── Form 14: goods delivered → requester's department must sign off ─────
    // Gated on the same field as 0014 Gate C, so the alert and the gate can
    // never disagree about whether sign-off is outstanding.
    const awaitingSignOff =
      ['FULFILLED', 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED', 'IN_TRANSIT'].includes(
        row.overall_status
      ) && (row.requester_verification ?? 'PENDING_DELIVERY') !== 'VERIFIED'

    if (awaitingSignOff && isMine(row) && !onHold) {
      alerts.push({
        kind: 'DELIVERY_SIGN_OFF',
        mrsId: row.id,
        mrsNumber: row.mrs_number,
        title: `${row.mrs_number} — awaiting delivery sign-off`,
        detail:
          'Confirm what was received. This records the spare change owed back to Accounting.',
        href: '/delivery/verify',
      })
    }
  }

  // Availability decisions block the whole purchase, so they surface first.
  const weight: Record<AlertKind, number> = {
    AVAILABILITY_DECISION: 0,
    AVAILABILITY_ANSWERED: 1,
    DELIVERY_SIGN_OFF: 2,
  }
  alerts.sort(
    (a, b) => weight[a.kind] - weight[b.kind] || a.mrsNumber.localeCompare(b.mrsNumber)
  )

  return { alerts, count: alerts.length, degraded: false }
}
