'use server'

import { createClient, getServerUser } from '@/lib/supabase/server'
import { logMRSActivity } from '@/lib/notifications/dispatcher'
import {
  AVAILABILITY_REPORT_ROLES,
  AVAILABILITY_REPORT_STATUSES,
  DECISIONS_ALLOWING_PURCHASE,
  DELIVERY_VERIFY_STATUSES,
  MINOR_DEFICIT_AMOUNT_DEFAULT,
  isAwaitingRequesterDecision,
  MINOR_DEFICIT_PERCENT_DEFAULT,
  PURCHASER_COMPLETE_TRIP_STATUSES,
  PURCHASER_CONFIRM_CASH_STATUSES,
  REQUESTER_DECISION_LABELS,
  SPARE_CHANGE_TOLERANCE,
  assertMRSTransition,
  type RequesterDecision,
} from '@/lib/status-machines'
import type { ItemDeliveryStatus, MRSStatus, UserRole } from '@/types/index'

/**
 * 0012 strict chain — cash gate helper.
 *
 * Returns the disbursed transmittal for an MRS, or null when Accounting has
 * not (yet) completed Form 11 (disburse cash & mark SENT). Emergency
 * Fast-Track requisitions bypass Forms 6-8-10 by design (Plan §6.A) and
 * never require a transmittal.
 */
async function getDisbursedTransmittal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  mrsId: number
) {
  const { data: tr } = await supabase
    .from('transmittal_forms')
    .select('id, transmittal_number, amount')
    .eq('mrs_id', mrsId)
    .eq('sender_status', 'SENT')
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  return tr
}

/**
 * 0013 Gate B — total cash actually disbursed against a requisition.
 *
 * Sums every non-return transmittal whose cash has moved (SENT or RECEIVED).
 * Prefers the SECURITY DEFINER `mrs_disbursed_total()` helper from migration
 * 0013 and degrades gracefully to a direct query when it is not deployed yet.
 */
async function getDisbursedTotal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  mrsId: number
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = await (supabase.rpc as any)('mrs_disbursed_total', { p_mrs_id: mrsId })
  if (!rpc?.error && rpc?.data !== null && rpc?.data !== undefined) {
    return Number(rpc.data) || 0
  }

  const { data: rows } = await supabase
    .from('transmittal_forms')
    .select('amount, transmittal_type, sender_status')
    .eq('mrs_id', mrsId)
    .in('sender_status', ['SENT', 'RECEIVED'])

  return (rows ?? [])
    .filter(r => r.transmittal_type !== 'SPARE_CHANGE_RETURN')
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
}

/**
 * Form 13 — Purchaser Confirms Cash Received (Plan.md §5 Form 13)
 */
export async function purchaserConfirmCash(mrsId: number) {
  const supabase = await createClient()
  const user = await getServerUser()
  if (!user) throw new Error('Session expired or invalid. Please sign in again.')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['SUPER_ADMIN', 'PURCHASER'].includes(profile.role as UserRole)) {
    throw new Error('Only Purchasers and Super Admins can confirm cash receipt.')
  }

  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, jo_id, overall_status, is_emergency_fast_track')
    .eq('id', mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')

  // 0011 flow fix: validate the transition up front — previously this action
  // fired from any status, so e.g. an EMERGENCY_FAST_TRACK requisition hit
  // the DB guard and failed with a cryptic error.
  assertMRSTransition(mrs.overall_status as MRSStatus, 'PURCHASING', mrs.mrs_number)
  if (!PURCHASER_CONFIRM_CASH_STATUSES.includes(mrs.overall_status as MRSStatus)) {
    throw new Error(
      `Cannot confirm cash receipt for a requisition in "${mrs.overall_status}". ` +
      `Allowed: ${PURCHASER_CONFIRM_CASH_STATUSES.join(', ')}.`
    )
  }

  // 0012 strict chain: the cash gate. Except for Emergency Fast-Track (which
  // bypasses Forms 6-8-10 by design), the transmittal must already have been
  // disbursed AND marked SENT by Accounting (Form 11) — otherwise the
  // requisition has not been released with cash and the float must not lock.
  if (!mrs.is_emergency_fast_track) {
    const disbursed = await getDisbursedTransmittal(supabase, mrs.id)
    if (!disbursed) {
      throw new Error(
        `Accounting has not disbursed and marked the transmittal as SENT for ${mrs.mrs_number} yet. ` +
        `Purchasers cannot confirm cash receipt / lock the float until Form 11 (Disburse & Mark Sent) is completed. ` +
        `Current status: ${mrs.overall_status}.`
      )
    }
  }

  const { error: updateError } = await supabase
    .from('material_requisitions')
    .update({ overall_status: 'PURCHASING' })
    .eq('id', mrsId)

  if (updateError) throw updateError

  await logMRSActivity({
    mrsId: mrs.id,
    mrsNumber: mrs.mrs_number,
    joId: mrs.jo_id ?? null,
    action: 'PURCHASER_CASH_CONFIRMED',
    performedBy: user.id,
    notes: 'Purchaser confirmed cash receipt; float locked for this requisition. Purchasing in progress.',
  })

  return { success: true }
}

/**
 * Form 13 — Purchaser reports a supply shortfall (0013 Gate A).
 *
 * When an item is unavailable, or only part of the requested quantity can be
 * sourced, the purchaser reports the available quantities instead of silently
 * buying less. The requisition goes on an availability hold and the requester
 * (or anyone in the requester's department) must decide how to proceed via
 * `requesterAvailabilityDecision` before actuals can be saved.
 */
export async function reportItemAvailability(params: {
  mrsId: number
  items: Array<{ lineItemId: number; qtyAvailable: number; availabilityNote?: string }>
  notes?: string
}) {
  const supabase = await createClient()
  const user = await getServerUser()
  if (!user) throw new Error('Session expired or invalid. Please sign in again.')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !AVAILABILITY_REPORT_ROLES.includes(profile.role as UserRole)) {
    throw new Error('Only Purchasers and Super Admins can report item availability.')
  }

  if (!params.items.length) {
    throw new Error('Report at least one item with its available quantity.')
  }

  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, jo_id, overall_status')
    .eq('id', params.mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')

  if (!AVAILABILITY_REPORT_STATUSES.includes(mrs.overall_status as MRSStatus)) {
    throw new Error(
      `Availability can only be reported while purchasing is underway. ` +
      `Requisition ${mrs.mrs_number} is "${mrs.overall_status}". ` +
      `Allowed: ${AVAILABILITY_REPORT_STATUSES.join(', ')}.`
    )
  }

  // Re-fetch the line items so quantities are validated against the DB, never
  // against client-supplied requested quantities.
  const { data: lineItems, error: itemsErr } = await supabase
    .from('mrs_line_items')
    .select('id, item_description, qty_requested, qty_issued_from_stock')
    .eq('mrs_id', params.mrsId)

  if (itemsErr || !lineItems) throw new Error('Failed to retrieve line items for this requisition.')
  const lineById = new Map(lineItems.map(l => [l.id, l]))

  const shortfalls: string[] = []

  for (const item of params.items) {
    const line = lineById.get(item.lineItemId)
    if (!line) {
      throw new Error(`Line item ${item.lineItemId} does not belong to this requisition.`)
    }

    const outstanding = Math.max(0, line.qty_requested - (line.qty_issued_from_stock || 0))
    const available = Number(item.qtyAvailable)
    if (!Number.isInteger(available) || available < 0) {
      throw new Error(`Available quantity for "${line.item_description}" must be a whole number of 0 or more.`)
    }
    if (available > outstanding) {
      throw new Error(
        `Available quantity for "${line.item_description}" (${available}) exceeds the outstanding quantity (${outstanding}).`
      )
    }

    const { error: updErr } = await supabase
      .from('mrs_line_items')
      .update({
        qty_available: available,
        availability_note: item.availabilityNote?.trim() || null,
        // Flag the line so Form 14 and the ledger show WHY it fell short.
        item_delivery_status: (available === 0 ? 'UNAVAILABLE' : 'PENDING') as ItemDeliveryStatus,
      })
      .eq('id', item.lineItemId)

    if (updErr) throw updErr

    if (available < outstanding) {
      shortfalls.push(`${line.item_description}: ${available} of ${outstanding} available`)
    }
  }

  if (!shortfalls.length) {
    throw new Error(
      'Every reported item is fully available — no availability hold is needed. ' +
      'Proceed with the purchase and save the actuals instead.'
    )
  }

  const { error: holdErr } = await supabase
    .from('material_requisitions')
    .update({
      availability_hold: true,
      availability_notes: params.notes?.trim() || shortfalls.join('; '),
      availability_reported_at: new Date().toISOString(),
      availability_reported_by: user.id,
      requester_decision: 'PENDING',
      requester_decision_notes: null,
      requester_decision_at: null,
      requester_decision_by: null,
    })
    .eq('id', params.mrsId)

  if (holdErr) throw new Error(`Availability recorded, but the hold could not be placed: ${holdErr.message}`)

  await logMRSActivity({
    mrsId: mrs.id,
    mrsNumber: mrs.mrs_number,
    joId: mrs.jo_id ?? null,
    action: 'MRS_AVAILABILITY_REPORTED',
    performedBy: user.id,
    notes: `Supply shortfall reported — awaiting requester decision. ${shortfalls.join('; ')}`,
    metadata: { shortfalls },
  })

  return { success: true, shortfalls }
}

/**
 * Form 9 / Form 14 — The requester answers a purchaser's availability report
 * (0013 Gate A). Restricted to the requisition's own department (or a Super
 * Admin), the same rule Form 14 sign-off uses.
 */
export async function requesterAvailabilityDecision(params: {
  mrsId: number
  decision: Exclude<RequesterDecision, 'NONE' | 'PENDING'>
  notes?: string
}) {
  const supabase = await createClient()
  const user = await getServerUser()
  if (!user) throw new Error('Session expired or invalid. Please sign in again.')

  if (!DECISIONS_ALLOWING_PURCHASE.includes(params.decision) && params.decision !== 'WAIT_FULL') {
    throw new Error(`Unsupported availability decision "${params.decision}".`)
  }

  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, jo_id, department_id, availability_hold, requester_decision, department:departments(department_name)')
    .eq('id', params.mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')

  if (!mrs.availability_hold || mrs.requester_decision !== 'PENDING') {
    throw new Error(
      `Requisition ${mrs.mrs_number} is not waiting for an availability decision.`
    )
  }

  const { data: decider } = await supabase
    .from('users')
    .select('id, full_name, department_id, role')
    .eq('id', user.id)
    .single()

  if (decider && decider.role !== 'SUPER_ADMIN') {
    if (!mrs.department_id || decider.department_id !== mrs.department_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deptName = (mrs.department as any)?.department_name ?? "the requester's"
      throw new Error(
        `Only users in the requester's department (${deptName}) may decide how to proceed with a partial supply. ` +
        `You are signed in as ${decider.full_name ?? user.email}.`
      )
    }
  }

  // WAIT_FULL keeps the hold in place (purchase stays blocked); the other two
  // decisions release the purchaser to buy the available quantity.
  const releases = params.decision !== 'WAIT_FULL'

  const { error: updErr } = await supabase
    .from('material_requisitions')
    .update({
      requester_decision: params.decision,
      requester_decision_notes: params.notes?.trim() || null,
      requester_decision_at: new Date().toISOString(),
      requester_decision_by: user.id,
      availability_hold: !releases,
    })
    .eq('id', params.mrsId)

  if (updErr) throw new Error(`Failed to record the decision: ${updErr.message}`)

  // CANCEL_REMAINING formally drops the unavailable balance so the purchaser
  // is not expected to source it later.
  if (params.decision === 'CANCEL_REMAINING') {
    const { data: lines } = await supabase
      .from('mrs_line_items')
      .select('id, qty_requested, qty_issued_from_stock, qty_available')
      .eq('mrs_id', params.mrsId)

    for (const line of lines ?? []) {
      if (line.qty_available === null || line.qty_available === undefined) continue
      const outstanding = Math.max(0, line.qty_requested - (line.qty_issued_from_stock || 0))
      if (line.qty_available < outstanding) {
        await supabase
          .from('mrs_line_items')
          .update({ item_delivery_status: 'UNAVAILABLE' as ItemDeliveryStatus })
          .eq('id', line.id)
      }
    }
  }

  await logMRSActivity({
    mrsId: mrs.id,
    mrsNumber: mrs.mrs_number,
    joId: mrs.jo_id ?? null,
    action: 'MRS_AVAILABILITY_DECISION',
    performedBy: user.id,
    notes:
      `Requester decision: ${REQUESTER_DECISION_LABELS[params.decision]}` +
      (params.notes?.trim() ? ` — ${params.notes.trim()}` : ''),
    previousState: { requester_decision: mrs.requester_decision },
    resultingState: { requester_decision: params.decision, availability_hold: !releases },
  })

  return { success: true, decision: params.decision, purchaseReleased: releases }
}

export interface PurchaseItemResult {
  lineItemId: number
  itemDescription: string
  storeName: string
  qtyFulfilled: number
  actualUnitPrice: number
  itemDeliveryStatus: ItemDeliveryStatus
  vendorRating: number
  isOverpriced: boolean
  receiptPhotoUrl?: string
}

/**
 * Form 13 — Purchaser Completes Store Trip & Logs Line Items (Plan.md §5 Form 13)
 */
export async function purchaserCompleteTrip(params: {
  mrsId: number
  actualShippingFee: number
  items: PurchaseItemResult[]
}) {
  const supabase = await createClient()
  const user = await getServerUser()
  if (!user) throw new Error('Session expired or invalid. Please sign in again.')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['SUPER_ADMIN', 'PURCHASER'].includes(profile.role as UserRole)) {
    throw new Error('Only Purchasers and Super Admins can complete a purchasing trip.')
  }

  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, jo_id, allocated_budget, overall_status, is_emergency_fast_track, availability_hold, requester_decision')
    .eq('id', params.mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')

  // 0013 Gate A: a reported supply shortfall freezes the purchase until the
  // requester decides how to proceed (proceed with what is available, wait for
  // full stock, or cancel the balance). The DB guard enforces the same rule.
  if (isAwaitingRequesterDecision(mrs)) {
    throw new Error(
      `Requisition ${mrs.mrs_number} is on an availability hold — the requester has not yet decided ` +
      `how to proceed with the reported shortfall. Actuals cannot be saved until they answer (Form 9).`
    )
  }
  if (mrs.availability_hold && mrs.requester_decision === 'WAIT_FULL') {
    throw new Error(
      `The requester chose to WAIT for full availability on ${mrs.mrs_number}. ` +
      `Do not purchase a partial quantity — report availability again once the full quantity can be sourced.`
    )
  }

  // 0012 strict chain: actuals can only be saved once the purchase is
  // underway — in-store from PURCHASING (cash confirmed & float locked),
  // online/COD from IN_TRANSIT (shipped after cash confirmation), or the
  // direct Emergency Fast-Track purchase. Saving actuals from any earlier
  // stage (before the transmittal was disbursed) is now rejected.
  if (!PURCHASER_COMPLETE_TRIP_STATUSES.includes(mrs.overall_status as MRSStatus)) {
    throw new Error(
      `Cannot save actuals / forward to delivery for a requisition in "${mrs.overall_status}". ` +
      `The chain is: Accounting disburses & marks the transmittal SENT → Purchaser confirms cash & locks the float → purchase & save actuals. ` +
      `Allowed: ${PURCHASER_COMPLETE_TRIP_STATUSES.join(', ')}.`
    )
  }

  // 0012 strict chain (cash gate, second checkpoint): even at this stage the
  // non-fast-track requisition must have a disbursed (SENT) transmittal.
  if (!mrs.is_emergency_fast_track) {
    const disbursed = await getDisbursedTransmittal(supabase, params.mrsId)
    if (!disbursed) {
      throw new Error(
        `No transmittal for ${mrs.mrs_number} has been disbursed & marked SENT by Accounting. ` +
        `Actuals cannot be saved and the delivery cannot be forwarded until the cash chain is complete.`
      )
    }
  }

  // 0011 flow fix: qty_fulfilled must represent TOTAL fulfillment
  // (warehouse-issued + purchased). Fetch the stock-issued quantities so we
  // can clamp and accumulate instead of overwriting.
  const { data: lineItems, error: itemsErr } = await supabase
    .from('mrs_line_items')
    .select('id, item_description, qty_requested, qty_issued_from_stock, qty_available')
    .eq('mrs_id', params.mrsId)

  if (itemsErr || !lineItems) throw new Error('Failed to retrieve line items for the trip.')
  const lineById = new Map(lineItems.map(l => [l.id, l]))

  // Minor-deficit thresholds are now data (system_settings, migration 0011)
  // instead of hardcoded constants.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const amountRpc = await (supabase.rpc as any)('get_setting_numeric', {
    p_key: 'mrs.minor_deficit_amount',
    p_default: MINOR_DEFICIT_AMOUNT_DEFAULT,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pctRpc = await (supabase.rpc as any)('get_setting_numeric', {
    p_key: 'mrs.minor_deficit_percent',
    p_default: MINOR_DEFICIT_PERCENT_DEFAULT,
  })
  const minorDeficitAmount = Number(amountRpc?.data ?? MINOR_DEFICIT_AMOUNT_DEFAULT)
  const minorDeficitPercent = Number(pctRpc?.data ?? MINOR_DEFICIT_PERCENT_DEFAULT)

  let totalActualSpent = Number(params.actualShippingFee) || 0
  let hasDeficitMajor = false

  for (const item of params.items) {
    const line = lineById.get(item.lineItemId)
    if (!line) {
      throw new Error(`Line item ${item.lineItemId} does not belong to this requisition.`)
    }

    // Clamp the purchased quantity to what is actually still outstanding
    // (requested minus what the warehouse already issued).
    const alreadyIssued = line.qty_issued_from_stock || 0
    const remaining = Math.max(0, line.qty_requested - alreadyIssued)
    // 0013: when availability was reported and the requester approved a
    // partial purchase, the reported available quantity is the hard ceiling —
    // a purchaser cannot bill for more than the supplier could provide.
    const availabilityCeiling =
      line.qty_available === null || line.qty_available === undefined
        ? remaining
        : Math.min(remaining, line.qty_available)
    const requestedQty = Number(item.qtyFulfilled) || 0
    if (requestedQty > availabilityCeiling) {
      throw new Error(
        `Cannot record ${requestedQty} of "${line.item_description}" — only ${availabilityCeiling} ` +
        `${line.qty_available !== null && line.qty_available !== undefined ? 'was reported available' : 'is still outstanding'}.`
      )
    }
    const purchasedQty = Math.max(0, Math.min(requestedQty, availabilityCeiling))

    const itemTotal = (Number(item.actualUnitPrice) || 0) * purchasedQty
    totalActualSpent += itemTotal

    // Update line item — qty_fulfilled = stock issued + purchased (0011)
    const { error: itemErr } = await supabase
      .from('mrs_line_items')
      .update({
        qty_fulfilled: alreadyIssued + purchasedQty,
        actual_unit_price: item.actualUnitPrice,
        item_delivery_status: item.itemDeliveryStatus,
        vendor_rating: item.vendorRating,
        is_overpriced: item.isOverpriced,
        purchased_at: new Date().toISOString(),
      })
      .eq('id', item.lineItemId)

    if (itemErr) throw itemErr

    // Attach purchase receipt if uploaded
    if (item.receiptPhotoUrl) {
      await supabase.from('attachments').insert({
        context: 'PURCHASE_RECEIPT',
        entity_type: 'mrs_line_item',
        entity_id: item.lineItemId,
        file_url: item.receiptPhotoUrl,
        uploaded_by: user.id,
      })
    }

    // Catalog upsert and vendor inflation flagging (§6.E)
    if (item.storeName && item.actualUnitPrice > 0) {
      const { data: existingCatalog } = await supabase
        .from('item_price_catalog')
        .select('id, overpriced_flag_count')
        .eq('item_description', item.itemDescription)
        .eq('store_name', item.storeName)
        .single()

      if (existingCatalog) {
        const nextCount = item.isOverpriced
          ? (existingCatalog.overpriced_flag_count || 0) + 1
          : (existingCatalog.overpriced_flag_count || 0)

        await supabase
          .from('item_price_catalog')
          .update({
            last_unit_price: item.actualUnitPrice,
            is_overpriced_flag: item.isOverpriced || nextCount > 0,
            overpriced_flag_count: nextCount,
            last_purchased_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingCatalog.id)
      } else {
        await supabase
          .from('item_price_catalog')
          .insert({
            item_description: item.itemDescription,
            store_name: item.storeName,
            last_unit_price: item.actualUnitPrice,
            is_overpriced_flag: item.isOverpriced,
            overpriced_flag_count: item.isOverpriced ? 1 : 0,
            last_purchased_at: new Date().toISOString(),
          })
      }
    }

    if (item.itemDeliveryStatus === 'BUDGET_EXHAUSTED') {
      hasDeficitMajor = true
    }
  }

  const allocated = Number(mrs.allocated_budget) || 0
  const variance = allocated - totalActualSpent
  const spareChange = variance > 0 ? variance : 0

  // Check budget deficit threshold: minor (<= configured ₱ or % of budget) vs major
  const overBudgetAmount = totalActualSpent - allocated
  const isOverBudget = overBudgetAmount > 0
  const isMinorDeficit =
    isOverBudget &&
    (overBudgetAmount <= minorDeficitAmount ||
      overBudgetAmount <= allocated * (minorDeficitPercent / 100))

  let nextStatus: MRSStatus = 'FULFILLED'
  if (hasDeficitMajor || (isOverBudget && !isMinorDeficit)) {
    nextStatus = 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED'
  }

  // Validate the forward move against the canonical state machine before
  // writing (0012 — the DB guard 0011/0012 is the second line of defense).
  assertMRSTransition(mrs.overall_status as MRSStatus, nextStatus, mrs.mrs_number)

  const { error: mrsUpdateError } = await supabase
    .from('material_requisitions')
    .update({
      actual_shipping_fee: params.actualShippingFee,
      total_actual_spent: totalActualSpent,
      spare_change_amount: spareChange,
      budget_variance_amount: variance,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      overall_status: nextStatus as any,
    })
    .eq('id', params.mrsId)

  if (mrsUpdateError) throw new Error(`Actuals saved, but the requisition update failed: ${mrsUpdateError.message}`)

  await logMRSActivity({
    mrsId: mrs.id,
    mrsNumber: mrs.mrs_number,
    joId: mrs.jo_id ?? null,
    action: 'PURCHASER_TRIP_COMPLETED',
    performedBy: user.id,
    notes: `Purchasing completed. Spent: ₱${totalActualSpent.toFixed(2)} (Allocated: ₱${allocated.toFixed(2)}). Status: ${nextStatus}`,
  })

  return { success: true, nextStatus, totalActualSpent, variance }
}

/**
 * Form 14 — Requester Delivery Sign-Off (Plan.md §5 Form 14)
 */
export async function verifyDeliveryRequester(params: {
  mrsId: number
  verified: boolean
  verificationNotes?: string
}) {
  const supabase = await createClient()
  const user = await getServerUser()
  if (!user) throw new Error('Session expired or invalid. Please sign in again.')

  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, jo_id, overall_status, department_id, total_actual_spent, spare_change_returned, department:departments(department_name)')
    .eq('id', params.mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')

  // 0011 flow fix: only sign-off-ready requisitions may be verified — this
  // includes IN_TRANSIT (online/COD orders that shipped first).
  if (!DELIVERY_VERIFY_STATUSES.includes(mrs.overall_status as MRSStatus)) {
    throw new Error(
      `Cannot verify delivery for a requisition in "${mrs.overall_status}". ` +
      `Allowed: ${DELIVERY_VERIFY_STATUSES.join(', ')}.`
    )
  }

  // 0012 strict chain (Form 14): delivery sign-off is done by any user in
  // the REQUESTER'S department (the department the requisition belongs to —
  // where the materials arrive), or by a Super Admin. Anyone else is rejected.
  const { data: verifier } = await supabase
    .from('users')
    .select('id, full_name, department_id, role')
    .eq('id', user.id)
    .single()

  if (verifier && verifier.role !== 'SUPER_ADMIN') {
    if (!mrs.department_id || verifier.department_id !== mrs.department_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deptName = (mrs.department as any)?.department_name ?? 'the requester\'s'
      throw new Error(
        `Only users in the requester's department (${deptName}) may sign off this delivery. ` +
        `You are signed in as ${verifier.full_name ?? user.email}. ` +
        `Ask a colleague from that department, or a Super Admin, to verify.`
      )
    }
  }

  if (params.verified) {
    // 0013 Gate B: sign-off is the moment the money owed back becomes known.
    // spare_change_required = cash actually disbursed (SENT/RECEIVED
    // transmittals, excluding returns) − what was actually spent. Accounting
    // cannot close the transmittal/requisition until this much is handed back.
    const disbursed = await getDisbursedTotal(supabase, params.mrsId)
    const spent = Number(mrs.total_actual_spent) || 0
    const requiredRaw = disbursed - spent
    const spareRequired = requiredRaw > SPARE_CHANGE_TOLERANCE ? Number(requiredRaw.toFixed(2)) : 0

    // Verified: MRS remains FULFILLED, linked JO moves to MATERIALS_RECEIVED (Plan.md §5 Form 14)
    const { error: mrsUpdateError } = await supabase
      .from('material_requisitions')
      .update({
        overall_status: 'FULFILLED',
        requester_verification: 'VERIFIED',
        verification_notes: params.verificationNotes || null,
        verified_at: new Date().toISOString(),
        spare_change_required: spareRequired,
      })
      .eq('id', params.mrsId)

    if (mrsUpdateError) throw new Error(`Failed to verify delivery: ${mrsUpdateError.message}`)

    if (spareRequired > 0) {
      await logMRSActivity({
        mrsId: mrs.id,
        mrsNumber: mrs.mrs_number,
        joId: mrs.jo_id ?? null,
        action: 'MRS_SPARE_CHANGE_REQUIRED',
        performedBy: user.id,
        notes:
          `Delivery signed off. Spare change of ₱${spareRequired.toFixed(2)} must be returned to Accounting ` +
          `(disbursed ₱${disbursed.toFixed(2)} − spent ₱${spent.toFixed(2)}).`,
        metadata: { disbursed, spent, spare_change_required: spareRequired },
      })
    }

    if (mrs.jo_id) {
      const { error: joUpdateError } = await supabase
        .from('job_orders')
        .update({ status: 'MATERIALS_RECEIVED' })
        .eq('id', mrs.jo_id)

      if (joUpdateError) {
        throw new Error(`Delivery verified, but the linked Job Order could not advance: ${joUpdateError.message}`)
      }
    }

    await logMRSActivity({
      mrsId: mrs.id,
      mrsNumber: mrs.mrs_number,
      joId: mrs.jo_id ?? null,
      action: 'MRS_DELIVERY_VERIFIED',
      performedBy: user.id,
      notes: 'Requester confirmed receipt of materials. Linked JO updated to MATERIALS_RECEIVED.',
    })

  } else {
    // Disputed
    const { error: mrsUpdateError } = await supabase
      .from('material_requisitions')
      .update({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        overall_status: 'DISPUTED' as any,
        requester_verification: 'DISPUTED',
        verification_notes: params.verificationNotes || 'Disputed by requester',
        verified_at: new Date().toISOString(),
      })
      .eq('id', params.mrsId)

    if (mrsUpdateError) throw new Error(`Failed to record delivery dispute: ${mrsUpdateError.message}`)

    await logMRSActivity({
      mrsId: mrs.id,
      mrsNumber: mrs.mrs_number,
      joId: mrs.jo_id ?? null,
      action: 'MRS_DELIVERY_DISPUTED',
      performedBy: user.id,
      notes: `Delivery disputed: ${params.verificationNotes}`,
    })

  }

  return { success: true }
}
