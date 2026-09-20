'use server'

import { createClient, getServerUser } from '@/lib/supabase/server'
import { runServerAction } from '@/lib/actions/action-results'
import { logMRSActivity } from '@/lib/notifications/dispatcher'
import {
  FAST_TRACK_ALLOWED_DEPTS,
  FAST_TRACK_CAP_DEFAULT,
  JO_STATUSES_FOR_MRS_LINK,
  MRS_STATUSES_FOR_IN_TRANSIT,
  MRS_IN_TRANSIT_ROLES,
  MANAGER_REVIEW_ROLES,
  CANVASS_ROLES,
  OWNER_DECISION_ROLES,
  FAST_TRACK_AUDIT_ROLES,
  CROSS_DEPARTMENT_MRS_ROLES,
  assertMRSTransition,
} from '@/lib/status-machines'
import type { MRSStatus, ItemDeliveryStatus, UserRole } from '@/types/index'

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
 * Resolve the signed-in actor and assert their role is one of `allowed`.
 *
 * Every gate-bearing MRS action runs through this. `ROUTE_ACCESS_RULES` hide the
 * screens, but a Server Action can be invoked directly — console or crafted
 * request — so the role check has to live beside the write too (audit §A2).
 * Throws: callers are client components that surface `error.message`.
 */
async function requireActorRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  allowed: readonly UserRole[],
  message: string
) {
  const user = await getServerUser()

  if (!user) {
    throw new Error('Session expired or invalid. Please sign in again.')
  }

  const { data: profile } = await supabase
    .from('users')
    .select('id, role, department_id, full_name')
    .eq('id', user.id)
    .single()

  if (!profile) {
    throw new Error('User profile record not found.')
  }

  const actor = profile as {
    id: string
    role: UserRole
    department_id: number | null
    full_name: string | null
  }

  if (!allowed.includes(actor.role)) {
    throw new Error(message)
  }

  return { user, actor }
}

/**
 * Form 5 — Create Material Requisition (Plan.md §5 Form 5 & §6.A)
 */
export async function createMRS(input: CreateMRSInput) {
  return runServerAction(
    'createMRS',
    { request_type: input.request_type, jo_id: input.jo_id ?? null, line_item_count: input.line_items.length },
    () => createMRSImpl(input)
  )
}

async function createMRSImpl(input: CreateMRSInput) {
  const supabase = await createClient()
  const user = await getServerUser()

  if (!user) {
    throw new Error('Session expired or invalid. Please sign in again.')
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

  // Department resolution (audit §B8). The requisition is filed for the actor's
  // own department; the client's `department_id` is only honoured for roles that
  // may file on another department's behalf (Form 5 cross-department filing —
  // Managers and SUPER_ADMIN, e.g. for a dept without system access). A profile
  // with no department is a hard stop rather than a pass-through of whatever the
  // client sent: this value drives Gate 2/3 scoping and the Form 14 sign-off.
  // users.role is NOT NULL (0001), so a loaded profile always carries one.
  const actorRole = (profile as { role: UserRole }).role
  const userDeptId = (profile as { department_id?: number | null }).department_id ?? null
  let department_id = input.department_id

  if (!CROSS_DEPARTMENT_MRS_ROLES.includes(actorRole)) {
    if (!userDeptId) {
      throw new Error(
        'Your user profile has no department assigned. Ask an administrator to set your department before filing a requisition.'
      )
    }
    if (userDeptId !== input.department_id) {
      throw new Error(
        `You can only submit requisitions for your own department (${deptName}).`
      )
    }
    department_id = userDeptId
  } else if (!input.department_id) {
    throw new Error('Select the department this requisition is for.')
  }

  // Validate line items (DB column limits: description 255, unit 50, store 150)
  if (!input.line_items || input.line_items.length === 0) {
    throw new Error('At least one line item is required.')
  }
  for (const item of input.line_items) {
    if (item.item_description.trim().length > 255) {
      throw new Error('Each item description must be 255 characters or fewer.')
    }
    if ((item.unit || '').trim().length > 50) {
      throw new Error('Each item unit must be 50 characters or fewer.')
    }
    if (item.store_name && item.store_name.trim().length > 150) {
      throw new Error('Each store name must be 150 characters or fewer.')
    }
    if (item.qty_requested <= 0 || !Number.isInteger(item.qty_requested)) {
      throw new Error('Each item must have a whole-number quantity greater than zero.')
    }
  }

  // Validate the linked Job Order BEFORE writing anything — otherwise the
  // status guard would raise after the MRS row + line items already exist,
  // orphaning the requisition (0011 flow fix).
  let linkedJOPriority: string | null = null
  if (input.jo_id) {
    const { data: linkedJO, error: joErr } = await supabase
      .from('job_orders')
      .select('id, jo_number, status, priority')
      .eq('id', input.jo_id)
      .single()

    if (joErr || !linkedJO) {
      throw new Error('The linked Job Order no longer exists.')
    }
    if (!(JO_STATUSES_FOR_MRS_LINK as readonly string[]).includes(linkedJO.status)) {
      throw new Error(
        `Job Order ${linkedJO.jo_number} is "${linkedJO.status}" and can no longer receive requisitions. ` +
        `Only tickets in ${JO_STATUSES_FOR_MRS_LINK.join(', ')} may be linked.`
      )
    }
    linkedJOPriority = linkedJO.priority
  }

  const currentYear = new Date().getFullYear()

  // Generate atomic reference number using next_reference_number('MRS', year) (Plan.md §3.4).
  // NOTE: no random fallback — a non-atomic number would break the
  // MRS-YYYY-NNNNNN ledger sequence and could collide under concurrency.
  const { data: generatedNumber, error: rpcError } = await supabase.rpc(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'next_reference_number' as any,
    { p_prefix: 'MRS', p_year: currentYear }
  )

  if (rpcError || !generatedNumber) {
    throw new Error(
      rpcError?.message ||
      'Reference numbering service is unavailable. Please retry — your requisition was not created.'
    )
  }
  const mrsNumber = generatedNumber as unknown as string

  // Compute total estimated cost
  const itemsSubtotal = input.line_items.reduce(
    (sum, item) => sum + (Number(item.est_unit_price) || 0) * (Number(item.qty_requested) || 1),
    0
  )
  const totalEstimatedCost = itemsSubtotal + (Number(input.est_shipping_fee) || 0)

  // Emergency Fast-Track Gating (Plan.md §6.A):
  // 1. Only Kitchen, F&B, Housekeeping, and Maintenance may set is_emergency_fast_track = true
  // 2. Only when linked JO priority = 'EMERGENCY'
  // 3. total_estimated_cost <= fast-track cap (system_settings, default ₱3,000)
  let isFastTrack = false
  const deptMatchesFastTrack = FAST_TRACK_ALLOWED_DEPTS.some(
    d => deptName.toLowerCase().includes(d)
  )

  // Cap lives in system_settings (migration 0011) so Finance can adjust it
  // without a code deploy; falls back to the historical ₱3,000.00.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const capRpc = await (supabase.rpc as any)('get_setting_numeric', {
    p_key: 'mrs.fast_track_cap_amount',
    p_default: FAST_TRACK_CAP_DEFAULT,
  })
  const fastTrackCap = Number(capRpc?.data ?? FAST_TRACK_CAP_DEFAULT)

  if (input.is_emergency_fast_track) {
    if (!deptMatchesFastTrack) {
      throw new Error('Emergency Fast-Track is restricted to Kitchen, F&B, Housekeeping, and Maintenance.')
    }
    if (!input.jo_id) {
      throw new Error('Emergency Fast-Track requires a linked EMERGENCY Job Order.')
    }

    if (linkedJOPriority !== 'EMERGENCY') {
      throw new Error('Emergency Fast-Track is only allowed for EMERGENCY priority Job Orders.')
    }

    if (totalEstimatedCost > fastTrackCap) {
      throw new Error(
        `Emergency Fast-Track total estimated cost cannot exceed ₱${fastTrackCap.toLocaleString('en-PH', { minimumFractionDigits: 2 })}.`
      )
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
      department_id,
      requester_id: user.id,
      purpose: input.purpose.trim(),
      is_online_purchase: input.is_online_purchase ?? false,
      online_supplier_url: input.online_supplier_url?.trim() || null,
      est_shipping_fee: input.est_shipping_fee || 0,
      total_estimated_cost: totalEstimatedCost,
      overall_status: overallStatus,
      is_emergency_fast_track: isFastTrack,
      fast_track_cap_amount: fastTrackCap,
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
 * Form 7 — Manager Approval / Rejection (Plan.md §5 Form 7)
 */
export async function managerReviewMRS(params: {
  mrsId: number
  approved: boolean
  rejectionReason?: string
}) {
  return runServerAction(
    'managerReviewMRS',
    { mrs_id: params.mrsId, approved: params.approved },
    () => managerReviewMRSImpl(params)
  )
}

async function managerReviewMRSImpl(params: {
  mrsId: number
  approved: boolean
  rejectionReason?: string
}) {
  const supabase = await createClient()
  const { user } = await requireActorRole(
    supabase,
    MANAGER_REVIEW_ROLES,
    'Only Managers and Super Admins can review a requisition on Form 7.'
  )

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
  assertMRSTransition(mrs.overall_status as MRSStatus, nextStatus, mrs.mrs_number)

  // B2 (audit §13.2): PostgREST reports an RLS-denied UPDATE as a *successful*
  // response that touched 0 rows, so this action used to write an approval
  // entry to the audit log for a review that never landed — and the requisition
  // stayed in PENDING_MANAGER with no error anywhere. `count: 'exact'` asks for
  // the affected-row count (no SELECT visibility needed) so the no-op is caught
  // before the log entry is written.
  const { error: reviewError, count: reviewedRows } = await supabase
    .from('material_requisitions')
    .update(
      {
        overall_status: nextStatus,
        manager_status: params.approved ? 'APPROVED' : 'REJECTED',
        manager_rejection_reason: params.approved ? null : params.rejectionReason?.trim(),
        manager_reviewed_at: new Date().toISOString(),
      },
      { count: 'exact' }
    )
    .eq('id', params.mrsId)

  if (reviewError) {
    throw new Error(`The manager review could not be saved on ${mrs.mrs_number}: ${reviewError.message}`)
  }
  if (!reviewedRows) {
    throw new Error(
      `The manager review was not saved: no row on ${mrs.mrs_number} could be updated. ` +
      `Your account may not have permission to modify this requisition — nothing was recorded.`
    )
  }

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
  return runServerAction(
    'recordCanvassPricing',
    { mrs_id: params.mrsId, item_count: params.items.length },
    () => recordCanvassPricingImpl(params)
  )
}

async function recordCanvassPricingImpl(params: {
  mrsId: number
  items: Array<{
    lineItemId: number
    storeName: string
    estUnitPrice: number
  }>
  totalCanvassedBudget: number
}) {
  const supabase = await createClient()
  const { user } = await requireActorRole(
    supabase,
    CANVASS_ROLES,
    'Only Budget Officers and Super Admins can record canvass pricing on Form 8.'
  )

  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, jo_id, overall_status, est_shipping_fee')
    .eq('id', params.mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')
  if (mrs.overall_status !== 'IN_CANVASSING') {
    throw new Error(`Cannot record canvass pricing for MRS in "${mrs.overall_status}" status.`)
  }

  // Fetch line items so the server can (a) enforce that every item still to
  // be procured is fully priced and (b) recompute the budget itself instead
  // of trusting the client total (0011 flow fix).
  const { data: lineItems, error: itemsErr } = await supabase
    .from('mrs_line_items')
    .select('id, item_description, qty_requested, qty_issued_from_stock')
    .eq('mrs_id', params.mrsId)

  if (itemsErr || !lineItems) throw new Error('Failed to retrieve line items for canvassing.')

  const pricedById = new Map(params.items.map(item => [item.lineItemId, item]))
  const unpriced = lineItems.filter(item => {
    const toProcure = Math.max(0, item.qty_requested - (item.qty_issued_from_stock || 0))
    if (toProcure <= 0) return false // fully covered by warehouse stock
    const entry = pricedById.get(item.id)
    return !entry || !entry.storeName.trim() || !(Number(entry.estUnitPrice) > 0)
  })

  if (unpriced.length > 0) {
    throw new Error(
      `All items still to procure need a supplier and a positive price before Owner approval. ` +
      `Missing: ${unpriced.map(i => i.item_description).join(', ')}`
    )
  }

  // Update line items with canvassed prices and store names
  for (const item of params.items) {
    const price = Number(item.estUnitPrice) || 0
    if (!Number.isFinite(price) || price < 0) {
      throw new Error('Canvassed unit prices must be zero or positive numbers.')
    }
    await supabase
      .from('mrs_line_items')
      .update({
        store_name: item.storeName.trim(),
        est_unit_price: price,
      })
      .eq('id', item.lineItemId)
  }

  // Server-side budget recompute: Σ (toProcure × canvassed price) + shipping
  let totalCanvassedBudget = Number(mrs.est_shipping_fee ?? 0) || 0
  for (const item of lineItems) {
    const toProcure = Math.max(0, item.qty_requested - (item.qty_issued_from_stock || 0))
    const entry = pricedById.get(item.id)
    totalCanvassedBudget += toProcure * (entry ? Number(entry.estUnitPrice) || 0 : 0)
  }
  totalCanvassedBudget = Math.round(totalCanvassedBudget * 100) / 100

  // Update MRS total and move to PENDING_OWNER
  const { error: mrsUpdateError } = await supabase
    .from('material_requisitions')
    .update({
      overall_status: 'PENDING_OWNER',
      allocated_budget: totalCanvassedBudget,
    })
    .eq('id', params.mrsId)

  if (mrsUpdateError) throw mrsUpdateError

  await logMRSActivity({
    mrsId: mrs.id,
    mrsNumber: mrs.mrs_number,
    joId: mrs.jo_id ?? null,
    action: 'MRS_CANVASSED_PENDING_OWNER',
    performedBy: user.id,
        notes: `Canvassed pricing logged (Budget: ₱${totalCanvassedBudget.toFixed(2)}). Sent snapshot to Owner.`,
    previousState: { overall_status: mrs.overall_status },
    resultingState: { overall_status: 'PENDING_OWNER', allocated_budget: totalCanvassedBudget },
    metadata: { priced_item_count: params.items.length },
  })

  return { success: true, totalCanvassedBudget }
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
  return runServerAction(
    'recordOwnerDecision',
    { mrs_id: params.mrsId, decision: params.decision },
    () => recordOwnerDecisionImpl(params)
  )
}

async function recordOwnerDecisionImpl(params: {
  mrsId: number
  decision: 'APPROVED' | 'REJECTED'
  rejectionReason?: string
  allocatedBudget?: number
}) {
  const supabase = await createClient()
  const { user } = await requireActorRole(
    supabase,
    OWNER_DECISION_ROLES,
    'Only Budget Officers and Super Admins can record the Owner decision on Form 8.'
  )

  if (
    params.decision === 'APPROVED' &&
    params.allocatedBudget !== undefined &&
    (!Number.isFinite(params.allocatedBudget) || params.allocatedBudget < 0)
  ) {
    throw new Error('The approved allocated budget must be zero or a positive number.')
  }

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
  assertMRSTransition(mrs.overall_status as MRSStatus, nextStatus, mrs.mrs_number)

  // B2 (audit §13.2): same silent-no-op hazard as Form 7 — an Owner decision
  // that RLS refused must not be logged as recorded.
  const { error: decisionError, count: decisionRows } = await supabase
    .from('material_requisitions')
    .update(
      {
        overall_status: nextStatus,
        owner_status: isApproved ? 'APPROVED' : 'REJECTED',
        owner_rejection_reason: isApproved ? null : params.rejectionReason?.trim(),
        owner_reviewed_at: new Date().toISOString(),
        ...(isApproved && params.allocatedBudget ? { allocated_budget: params.allocatedBudget } : {}),
      },
      { count: 'exact' }
    )
    .eq('id', params.mrsId)

  if (decisionError) {
    throw new Error(`The Owner decision could not be saved on ${mrs.mrs_number}: ${decisionError.message}`)
  }
  if (!decisionRows) {
    throw new Error(
      `The Owner decision was not saved: no row on ${mrs.mrs_number} could be updated. ` +
      `Your account may not have permission to modify this requisition — nothing was recorded.`
    )
  }

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
  return runServerAction(
    'postAuditFastTrack',
    { mrs_id: mrsId },
    () => postAuditFastTrackImpl(mrsId)
  )
}

async function postAuditFastTrackImpl(mrsId: number) {
  const supabase = await createClient()
  const { user } = await requireActorRole(
    supabase,
    FAST_TRACK_AUDIT_ROLES,
    'Only Managers, Budget Officers and Super Admins can post-audit an Emergency Fast-Track requisition (Plan §6.A step 3).'
  )

  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, is_emergency_fast_track, fast_track_audited_at')
    .eq('id', mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')
  if (!mrs.is_emergency_fast_track) throw new Error('Not an Emergency Fast-Track MRS.')
  if (mrs.fast_track_audited_at) throw new Error('Emergency Fast-Track MRS has already been post-audited.')

  // B2 (audit §13.2): the post-audit stamp is the only evidence that the
  // 24-hour Emergency Fast-Track was reviewed within the window, so a write
  // that silently touched 0 rows must fail here rather than be logged as done.
  const { error: auditError, count: auditRows } = await supabase
    .from('material_requisitions')
    .update(
      {
        fast_track_audited_at: new Date().toISOString(),
        fast_track_audited_by: user.id,
      },
      { count: 'exact' }
    )
    .eq('id', mrsId)

  if (auditError) {
    throw new Error(`The post-audit stamp could not be saved on ${mrs.mrs_number}: ${auditError.message}`)
  }
  if (!auditRows) {
    throw new Error(
      `The post-audit stamp was not saved: no row on ${mrs.mrs_number} could be updated. ` +
      `Your account may not have permission to modify this requisition — nothing was recorded.`
    )
  }

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

/**
 * Form 13 — Mark Requisition In Transit (0011 enhancement)
 * For online / COD orders that ship before the requester is on site:
 * APPROVED_READY_TO_ORDER / READY_FOR_PURCHASE / PURCHASING -> IN_TRANSIT.
 * The requisition then completes via the Form 14 delivery sign-off.
 */
export async function markMRSInTransit(mrsId: number, notes?: string) {
  return runServerAction(
    'markMRSInTransit',
    { mrs_id: mrsId },
    () => markMRSInTransitImpl(mrsId, notes)
  )
}

async function markMRSInTransitImpl(mrsId: number, notes?: string) {
  const supabase = await createClient()
  const user = await getServerUser()

  if (!user) throw new Error('Session expired or invalid. Please sign in again.')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !MRS_IN_TRANSIT_ROLES.includes(profile.role as UserRole)) {
    throw new Error('Only Purchasers and Super Admins can mark a requisition in transit.')
  }

  const { data: mrs, error: mrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, jo_id, overall_status')
    .eq('id', mrsId)
    .single()

  if (mrsErr || !mrs) throw new Error('MRS not found.')

  assertMRSTransition(mrs.overall_status as MRSStatus, 'IN_TRANSIT', mrs.mrs_number)
  if (!MRS_STATUSES_FOR_IN_TRANSIT.includes(mrs.overall_status as MRSStatus)) {
    throw new Error(
      `Cannot mark a requisition in transit from "${mrs.overall_status}". ` +
      `Allowed: ${MRS_STATUSES_FOR_IN_TRANSIT.join(', ')}.`
    )
  }

  const { error: updateError } = await supabase
    .from('material_requisitions')
    .update({ overall_status: 'IN_TRANSIT' })
    .eq('id', mrsId)

  if (updateError) throw updateError

  await logMRSActivity({
    mrsId: mrs.id,
    mrsNumber: mrs.mrs_number,
    joId: mrs.jo_id ?? null,
    action: 'MRS_MARKED_IN_TRANSIT',
    performedBy: user.id,
    notes: notes?.trim() || 'Online/COD order shipped — awaiting requester delivery sign-off.',
    previousState: { overall_status: mrs.overall_status },
    resultingState: { overall_status: 'IN_TRANSIT' },
  })

  return { success: true, status: 'IN_TRANSIT' }
}
