'use server'

import { createClient } from '@/lib/supabase/server'
import { logMRSActivity } from '@/lib/notifications/dispatcher'
import type { ItemDeliveryStatus } from '@/types/index'

/**
 * Form 13 — Purchaser Confirms Cash Received (Plan.md §5 Form 13)
 */
export async function purchaserConfirmCash(mrsId: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Authentication required.')

  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, jo_id, overall_status')
    .eq('id', mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')

  await supabase
    .from('material_requisitions')
    .update({ overall_status: 'PURCHASING' })
    .eq('id', mrsId)

  await logMRSActivity({
    mrsId: mrs.id,
    mrsNumber: mrs.mrs_number,
    joId: mrs.jo_id ?? null,
    action: 'PURCHASER_CASH_CONFIRMED',
    performedBy: user.id,
    notes: 'Purchaser confirmed cash receipt. Purchasing in progress.',
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Authentication required.')

  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, jo_id, allocated_budget')
    .eq('id', params.mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')

  let totalActualSpent = Number(params.actualShippingFee) || 0
  let hasDeficitMajor = false

  for (const item of params.items) {
    const itemTotal = (Number(item.actualUnitPrice) || 0) * (Number(item.qtyFulfilled) || 0)
    totalActualSpent += itemTotal

    // Update line item
    await supabase
      .from('mrs_line_items')
      .update({
        qty_fulfilled: item.qtyFulfilled,
        actual_unit_price: item.actualUnitPrice,
        item_delivery_status: item.itemDeliveryStatus,
        vendor_rating: item.vendorRating,
        is_overpriced: item.isOverpriced,
        purchased_at: new Date().toISOString(),
      })
      .eq('id', item.lineItemId)

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

  // Check budget deficit threshold: minor (<= 5% or <= 200) vs major
  const overBudgetAmount = totalActualSpent - allocated
  const isOverBudget = overBudgetAmount > 0
  const isMinorDeficit = isOverBudget && (overBudgetAmount <= 200 || overBudgetAmount <= allocated * 0.05)

  let nextStatus = 'FULFILLED'
  if (hasDeficitMajor || (isOverBudget && !isMinorDeficit)) {
    nextStatus = 'PARTIALLY_FULFILLED_BUDGET_EXHAUSTED'
  }

  await supabase
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Authentication required.')

  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, jo_id, overall_status')
    .eq('id', params.mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')

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
