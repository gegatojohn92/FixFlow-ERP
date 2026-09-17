'use server'

import { createClient } from '@/lib/supabase/server'
import { logMRSActivity } from '@/lib/notifications/dispatcher'
import type { MRSStatus, ItemDeliveryStatus } from '@/types/index'

export interface MRSLineItemInput {
  item_description: string
  qty_requested: number
  unit: string
  store_name?: string
  est_unit_price: number
  reference_photo_url?: string
}

export interface CreateMRSInput {
  request_type: 'STANDALONE' | 'JOB_ORDER'
  jo_id?: number | null
  department_id: number
  purpose: string
  is_online_purchase?: boolean
  online_supplier_url?: string
  est_shipping_fee?: number
  online_screenshot_url?: string
  is_emergency_fast_track?: boolean
  line_items: MRSLineItemInput[]
}

/**
 * Form 5 — Create Material Requisition (Plan.md §5 Form 5 & §6.A)
 */
export async function createMRS(input: CreateMRSInput) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new Error('Authentication required.')
  }

  // Fetch requester profile + department
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('id, role, department_id, department:departments(department_name)')
    .eq('id', user.id)
    .single()

  if (profileErr || !profile) {
    throw new Error('User profile record not found.')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deptName = (profile.department as any)?.department_name ?? ''

  // Validate line items
  if (!input.line_items || input.line_items.length === 0) {
    throw new Error('At least one line item is required.')
  }

  const currentYear = new Date().getFullYear()

  // Generate atomic reference number using next_reference_number('MRS', year) (Plan.md §3.4)
  let mrsNumber: string
  const { data: generatedNumber, error: rpcError } = await supabase.rpc(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'next_reference_number' as any,
    { p_prefix: 'MRS', p_year: currentYear }
  )

  if (rpcError || !generatedNumber) {
    const randomSuffix = Math.floor(100000 + Math.random() * 900000)
    mrsNumber = `MRS-${currentYear}-${randomSuffix}`
  } else {
    mrsNumber = generatedNumber as unknown as string
  }

  // Compute total estimated cost
  const itemsSubtotal = input.line_items.reduce(
    (sum, item) => sum + (Number(item.est_unit_price) || 0) * (Number(item.qty_requested) || 1),
    0
  )
  const totalEstimatedCost = itemsSubtotal + (Number(input.est_shipping_fee) || 0)

  // Emergency Fast-Track Gating (Plan.md §6.A):
  // 1. Only Kitchen, F&B, Housekeeping, and Maintenance may set is_emergency_fast_track = true
  // 2. Only when linked JO priority = 'EMERGENCY'
  // 3. total_estimated_cost <= 3000.00
  let isFastTrack = false
  const allowedFastTrackDepts = ['Kitchen', 'F&B', 'Housekeeping', 'Maintenance']
  const deptMatchesFastTrack = allowedFastTrackDepts.some(
    d => deptName.toLowerCase().includes(d.toLowerCase())
  )

  if (input.is_emergency_fast_track) {
    if (!deptMatchesFastTrack) {
      throw new Error('Emergency Fast-Track is restricted to Kitchen, F&B, Housekeeping, and Maintenance.')
    }
    if (!input.jo_id) {
      throw new Error('Emergency Fast-Track requires a linked EMERGENCY Job Order.')
    }

    const { data: linkedJO } = await supabase
      .from('job_orders')
      .select('priority')
      .eq('id', input.jo_id)
      .single()

    if (linkedJO?.priority !== 'EMERGENCY') {
      throw new Error('Emergency Fast-Track is only allowed for EMERGENCY priority Job Orders.')
    }

    if (totalEstimatedCost > 3000.00) {
      throw new Error('Emergency Fast-Track total estimated cost cannot exceed ₱3,000.00.')
    }

    isFastTrack = true
  }

  // Determine initial status:
  // If Fast-Track: EMERGENCY_FAST_TRACK (skips Forms 6, 7, 8, 10 entirely)
  // Otherwise: PENDING_MANAGER
  const overallStatus: MRSStatus = isFastTrack ? 'EMERGENCY_FAST_TRACK' : 'PENDING_MANAGER'

  // Insert MRS record
  const { data: newMRS, error: mrsError } = await supabase
    .from('material_requisitions')
    .insert({
      mrs_number: mrsNumber,
      request_type: input.request_type,
      jo_id: input.jo_id || null,
      department_id: input.department_id,
      requester_id: user.id,
      purpose: input.purpose.trim(),
      is_online_purchase: input.is_online_purchase ?? false,
      online_supplier_url: input.online_supplier_url?.trim() || null,
      est_shipping_fee: input.est_shipping_fee || 0,
      total_estimated_cost: totalEstimatedCost,
      overall_status: overallStatus,
      is_emergency_fast_track: isFastTrack,
      fast_track_cap_amount: 3000.00,
    })
    .select('*')
    .single()

  if (mrsError || !newMRS) {
    throw new Error(mrsError?.message || 'Failed to create Material Requisition.')
  }

  // Insert line items
  const lineItemRows = input.line_items.map(item => ({
    mrs_id: newMRS.id,
    item_description: item.item_description.trim(),
    qty_requested: item.qty_requested,
    unit: item.unit.trim(),
    store_name: item.store_name?.trim() || null,
    est_unit_price: item.est_unit_price || 0,
    reference_photo_url: item.reference_photo_url || null,
    item_delivery_status: 'PENDING' as ItemDeliveryStatus,
  }))

  const { data: insertedItems, error: itemsError } = await supabase
    .from('mrs_line_items')
    .insert(lineItemRows)
    .select('id, reference_photo_url')

  if (itemsError) {
    console.error('Failed to insert line items:', itemsError)
  }

  // Attachments: persist line-item reference photos if present
  if (insertedItems) {
    for (const item of insertedItems) {
      if (item.reference_photo_url) {
        await supabase.from('attachments').insert({
          context: 'MRS_ITEM_REFERENCE',
          entity_type: 'mrs_line_item',
          entity_id: item.id,
          file_url: item.reference_photo_url,
          uploaded_by: user.id,
        })
      }
    }
  }

  // Attachments: persist online screenshot if present
  if (input.online_screenshot_url) {
    await supabase.from('attachments').insert({
      context: 'MRS_ONLINE_SCREENSHOT',
      entity_type: 'mrs_line_item',
      entity_id: newMRS.id,
      file_url: input.online_screenshot_url,
      uploaded_by: user.id,
    })
  }

  // If linked to a Job Order, update JO status to AWAITING_MRS_APPROVAL
  // (per State Machine §4.1: IN_PROGRESS --> AWAITING_MRS_APPROVAL)
  if (input.jo_id) {
    await supabase
      .from('job_orders')
      .update({ status: 'AWAITING_MRS_APPROVAL' })
      .eq('id', input.jo_id)
  }

  // Structured Audit Log
  await logMRSActivity({
    mrsId: newMRS.id,
    mrsNumber,
    joId: input.jo_id ?? null,
    action: isFastTrack ? 'MRS_EMERGENCY_FAST_TRACK_CREATED' : 'MRS_CREATED',
    performedBy: user.id,
    notes: `Requisition ${mrsNumber} created (${input.line_items.length} items, est. ₱${totalEstimatedCost.toFixed(2)}). Status: ${overallStatus}`,
    resultingState: { overall_status: overallStatus },
    metadata: { line_item_count: input.line_items.length, total_estimated_cost: totalEstimatedCost },
  })

  return { success: true, mrs: newMRS }
}

/**
 * Form 6 — Storekeeper Stock Check Gate (Plan.md §5 Form 6 & §6.B)
 * If all items issued from stock: sets overall_status = 'ISSUED_FROM_STOCK',
 * linked JO status = 'MATERIALS_RECEIVED'.
 * If partially in stock: forwards balance to Form 7.
 */
export async function issueStockFormSK(params: {
  mrsId: number
  allocations: Array<{ lineItemId: number; qtyIssuedFromStock: number }>
  notes?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Authentication required.')

  // Verify MRS exists and is eligible
  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, jo_id, overall_status, is_emergency_fast_track')
    .eq('id', params.mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')
  if (mrs.overall_status !== 'PENDING_MANAGER') {
    throw new Error(`Cannot process stock check for MRS in "${mrs.overall_status}" status.`)
  }
  if (mrs.is_emergency_fast_track) {
    throw new Error('Emergency Fast-Track requisitions bypass warehouse stock check.')
  }

  // Fetch all line items for this MRS
  const { data: items, error: itemsErr } = await supabase
    .from('mrs_line_items')
    .select('id, qty_requested')
    .eq('mrs_id', params.mrsId)

  if (itemsErr || !items) throw new Error('Failed to retrieve line items.')

  let allFullyIssued = true

  for (const item of items) {
    const alloc = params.allocations.find(a => a.lineItemId === item.id)
    const qtyIssued = alloc ? Math.min(alloc.qtyIssuedFromStock, item.qty_requested) : 0

    if (qtyIssued < item.qty_requested) {
      allFullyIssued = false
    }

    await supabase
      .from('mrs_line_items')
      .update({
        qty_issued_from_stock: qtyIssued,
        qty_fulfilled: qtyIssued,
      })
      .eq('id', item.id)
  }

  // Status transition:
  // If fully in stock: ISSUED_FROM_STOCK (resolved in Plan.md §5 Form 6 & §0.6)
  // Linked JO becomes MATERIALS_RECEIVED
  // If partial: overall_status stays PENDING_MANAGER (or advances to Form 7)
  if (allFullyIssued) {
    await supabase
      .from('material_requisitions')
      .update({
        overall_status: 'ISSUED_FROM_STOCK',
      })
      .eq('id', params.mrsId)

    if (mrs.jo_id) {
      await supabase
        .from('job_orders')
        .update({ status: 'MATERIALS_RECEIVED' })
        .eq('id', mrs.jo_id)
    }
  }

  await logMRSActivity({
    mrsId: mrs.id,
    mrsNumber: mrs.mrs_number,
    joId: mrs.jo_id ?? null,
    action: allFullyIssued ? 'MRS_ISSUED_FROM_STOCK_COMPLETE' : 'MRS_STOCK_CHECK_PARTIAL',
    performedBy: user.id,
    notes: allFullyIssued
      ? `All items issued from warehouse stock. Marked ISSUED_FROM_STOCK.`
      : `Partial stock issued. Remainder forwarded for Manager approval.`,
    previousState: { overall_status: mrs.overall_status },
    resultingState: { overall_status: allFullyIssued ? 'ISSUED_FROM_STOCK' : mrs.overall_status },
    metadata: { allocations_count: params.allocations.length },
  })

  return { success: true, fullyIssued: allFullyIssued }
}

/**
 * Form 7 — Manager Approval / Rejection (Plan.md §5 Form 7)
 */
export async function managerReviewMRS(params: {
  mrsId: number
  approved: boolean
  rejectionReason?: string
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

  if (mrs.overall_status !== 'PENDING_MANAGER') {
    throw new Error(`Cannot review MRS in "${mrs.overall_status}" status.`)
  }

  const nextStatus: MRSStatus = params.approved ? 'IN_CANVASSING' : 'MANAGER_REJECTED'

  await supabase
    .from('material_requisitions')
    .update({
      overall_status: nextStatus,
      manager_status: params.approved ? 'APPROVED' : 'REJECTED',
      manager_rejection_reason: params.approved ? null : params.rejectionReason?.trim(),
      manager_reviewed_at: new Date().toISOString(),
    })
    .eq('id', params.mrsId)

  // If rejected and linked to a JO, linked JO -> MRS_REJECTED
  if (!params.approved && mrs.jo_id) {
    await supabase
      .from('job_orders')
      .update({ status: 'MRS_REJECTED' })
      .eq('id', mrs.jo_id)
  }

  await logMRSActivity({
    mrsId: mrs.id,
    mrsNumber: mrs.mrs_number,
    joId: mrs.jo_id ?? null,
    action: params.approved ? 'MRS_APPROVED_BY_MANAGER' : 'MRS_REJECTED_BY_MANAGER',
    performedBy: user.id,
    notes: params.approved
      ? 'Manager approved. Advanced to In Canvassing.'
      : `Manager rejected: ${params.rejectionReason || 'No reason provided'}`,
    previousState: { overall_status: mrs.overall_status, manager_status: 'PENDING' },
    resultingState: { overall_status: nextStatus, manager_status: params.approved ? 'APPROVED' : 'REJECTED' },
    metadata: params.approved ? {} : { rejection_reason: params.rejectionReason || 'No reason provided' },
  })

  return { success: true, status: nextStatus }
}

/**
 * Form 8 — Record Canvassed Pricing & Snapshot Sent to Owner (Plan.md §5 Form 8)
 */
export async function recordCanvassPricing(params: {
  mrsId: number
  items: Array<{
    lineItemId: number
    storeName: string
    estUnitPrice: number
  }>
  totalCanvassedBudget: number
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
  if (mrs.overall_status !== 'IN_CANVASSING') {
    throw new Error(`Cannot record canvass pricing for MRS in "${mrs.overall_status}" status.`)
  }

  // Update line items with canvassed prices and store names
  for (const item of params.items) {
    await supabase
      .from('mrs_line_items')
      .update({
        store_name: item.storeName.trim(),
        est_unit_price: item.estUnitPrice,
      })
      .eq('id', item.lineItemId)
  }

  // Update MRS total and move to PENDING_OWNER
  await supabase
    .from('material_requisitions')
    .update({
      overall_status: 'PENDING_OWNER',
      allocated_budget: params.totalCanvassedBudget,
    })
    .eq('id', params.mrsId)

  await logMRSActivity({
    mrsId: mrs.id,
    mrsNumber: mrs.mrs_number,
    joId: mrs.jo_id ?? null,
    action: 'MRS_CANVASSED_PENDING_OWNER',
    performedBy: user.id,
    notes: `Canvassed pricing logged (Budget: ₱${params.totalCanvassedBudget.toFixed(2)}). Sent snapshot to Owner.`,
    previousState: { overall_status: mrs.overall_status },
    resultingState: { overall_status: 'PENDING_OWNER', allocated_budget: params.totalCanvassedBudget },
    metadata: { priced_item_count: params.items.length },
  })

  return { success: true }
}

/**
 * Form 8 — Record Owner Off-Platform Decision (Plan.md §5 Form 8)
 */
export async function recordOwnerDecision(params: {
  mrsId: number
  decision: 'APPROVED' | 'REJECTED'
  rejectionReason?: string
  allocatedBudget?: number
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
  if (mrs.overall_status !== 'PENDING_OWNER') {
    throw new Error(`Cannot record Owner decision for MRS in "${mrs.overall_status}" status.`)
  }

  const isApproved = params.decision === 'APPROVED'
  const nextStatus: MRSStatus = isApproved ? 'APPROVED_READY_TO_ORDER' : 'OWNER_REJECTED'

  await supabase
    .from('material_requisitions')
    .update({
      overall_status: nextStatus,
      owner_status: isApproved ? 'APPROVED' : 'REJECTED',
      owner_rejection_reason: isApproved ? null : params.rejectionReason?.trim(),
      owner_reviewed_at: new Date().toISOString(),
      ...(isApproved && params.allocatedBudget ? { allocated_budget: params.allocatedBudget } : {}),
    })
    .eq('id', params.mrsId)

  if (!isApproved && mrs.jo_id) {
    await supabase
      .from('job_orders')
      .update({ status: 'MRS_REJECTED' })
      .eq('id', mrs.jo_id)
  }

  await logMRSActivity({
    mrsId: mrs.id,
    mrsNumber: mrs.mrs_number,
    joId: mrs.jo_id ?? null,
    action: isApproved ? 'MRS_OWNER_APPROVED' : 'MRS_OWNER_REJECTED',
    performedBy: user.id,
    notes: isApproved
      ? `Owner approved off-platform. Ready for transmittal / purchase order.`
      : `Owner rejected: ${params.rejectionReason || 'No reason provided'}`,
    previousState: { overall_status: mrs.overall_status, owner_status: 'PENDING' },
    resultingState: { overall_status: nextStatus, owner_status: isApproved ? 'APPROVED' : 'REJECTED' },
    metadata: isApproved ? {} : { rejection_reason: params.rejectionReason || 'No reason provided' },
  })

  return { success: true, status: nextStatus }
}

/**
 * Form 9 — Post-Audit Emergency Fast-Track (Plan.md §6.A Step 3)
 */
export async function postAuditFastTrack(mrsId: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Authentication required.')

  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, is_emergency_fast_track, fast_track_audited_at')
    .eq('id', mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')
  if (!mrs.is_emergency_fast_track) throw new Error('Not an Emergency Fast-Track MRS.')
  if (mrs.fast_track_audited_at) throw new Error('Emergency Fast-Track MRS has already been post-audited.')

  await supabase
    .from('material_requisitions')
    .update({
      fast_track_audited_at: new Date().toISOString(),
      fast_track_audited_by: user.id,
    })
    .eq('id', mrsId)

  await logMRSActivity({
    mrsId: mrs.id,
    mrsNumber: mrs.mrs_number,
    action: 'FAST_TRACK_POST_AUDIT_COMPLETED',
    performedBy: user.id,
    notes: `24-Hour Emergency Fast-Track post-audit verified and stamped.`,
    previousState: { fast_track_audited_at: null },
    resultingState: { fast_track_audited_at: 'SET', fast_track_audited_by: user.id },
  })

  return { success: true }
}
