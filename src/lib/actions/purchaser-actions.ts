'use server'

import { createClient, getServerUser } from '@/lib/supabase/server'
import { logMRSActivity } from '@/lib/notifications/dispatcher'
import {
  DELIVERY_VERIFY_STATUSES,
  MINOR_DEFICIT_AMOUNT_DEFAULT,
  MINOR_DEFICIT_PERCENT_DEFAULT,
  PURCHASER_COMPLETE_TRIP_STATUSES,
  PURCHASER_CONFIRM_CASH_STATUSES,
  assertMRSTransition,
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
    .select('id, mrs_number, jo_id, allocated_budget, overall_status, is_emergency_fast_track')
    .eq('id', params.mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')

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
    .select('id, qty_requested, qty_issued_from_stock')
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
    const purchasedQty = Math.max(0, Math.min(Number(item.qtyFulfilled) || 0, remaining))

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
    .select('id, mrs_number, jo_id, overall_status, department_id, department:departments(department_name)')
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
    // Verified: MRS remains FULFILLED, linked JO moves to MATERIALS_RECEIVED (Plan.md §5 Form 14)
    const { error: mrsUpdateError } = await supabase
      .from('material_requisitions')
      .update({
        overall_status: 'FULFILLED',
        requester_verification: 'VERIFIED',
        verification_notes: params.verificationNotes || null,
        verified_at: new Date().toISOString(),
      })
      .eq('id', params.mrsId)

    if (mrsUpdateError) throw new Error(`Failed to verify delivery: ${mrsUpdateError.message}`)

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
