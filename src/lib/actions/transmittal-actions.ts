'use server'

import { createClient, getServerUser } from '@/lib/supabase/server'
import { logTransmittalActivity } from '@/lib/notifications/dispatcher'
import {
  MRS_0013_DEFAULTS,
  PG_UNDEFINED_COLUMN,
  SPARE_CHANGE_TOLERANCE,
} from '@/lib/status-machines'
import type { TransmittalType, TransmittalStatus } from '@/types/index'

// ──────────────────────────────────────────────────────────
// Form 10 — Create Transmittal Form (Plan.md §5 Form 10)
// Access: Budget Officer, Super Admin
// ──────────────────────────────────────────────────────────

export interface CreateTransmittalInput {
  mrsId?: number | null
  transmittalType: TransmittalType
  amount: number
  receiverUserId: string
  notes?: string
}

/**
 * Creates a single transmittal for one MRS.
 * Auto-generates the transmittal_number via next_reference_number('TR', year).
 */
export async function createTransmittal(input: CreateTransmittalInput) {
  const supabase = await createClient()
  const user = await getServerUser()
  if (!user) throw new Error('Session expired or invalid. Please sign in again.')

  // Verify sender role
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['SUPER_ADMIN', 'BUDGET_OFFICER'].includes(profile.role)) {
    throw new Error('Only Budget Officers and Super Admins can create transmittals.')
  }

  if (!input.amount || input.amount <= 0) {
    throw new Error('Transmittal amount must be greater than zero.')
  }

  const currentYear = new Date().getFullYear()

  // Atomic numbering (Plan.md §3.4)
  const { data: generatedNumber, error: rpcError } = await supabase.rpc(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'next_reference_number' as any,
    { p_prefix: 'TR', p_year: currentYear }
  )

  if (rpcError || !generatedNumber) {
    // No random fallback — a non-atomic number would break the TR-YYYY-NNNNNN
    // ledger sequence and could collide under concurrency (0011 guardrail).
    throw new Error(
      rpcError?.message ||
      'Reference numbering service is unavailable. Please retry — the transmittal was not created.'
    )
  }
  const trNumber = generatedNumber as unknown as string

  // If linked to MRS, move it to TRANSMITTAL_IN_PROGRESS — but only forward:
  // the FIRST transmittal takes APPROVED_READY_TO_ORDER → TRANSMITTAL_IN_PROGRESS.
  // Supplemental/batch transmittals on an MRS already disbursed must not push
  // the state machine backwards (READY_FOR_PURCHASE → TRANSMITTAL_IN_PROGRESS
  // is not a legal transition and would fail the DB guard).
  // 0012: terminal/resolved requisitions cannot receive new transmittals.
  if (input.mrsId) {
    const { data: mrsStatus, error: mrsFetchErr } = await supabase
      .from('material_requisitions')
      .select('id, mrs_number, overall_status')
      .eq('id', input.mrsId)
      .single()

    if (mrsFetchErr || !mrsStatus) {
      throw new Error('The linked requisition no longer exists.')
    }
    if (['CLOSED', 'VOIDED', 'ISSUED_FROM_STOCK'].includes(mrsStatus.overall_status)) {
      throw new Error(
        `Requisition ${mrsStatus.mrs_number} is ${mrsStatus.overall_status} and can no longer receive transmittals.`
      )
    }
    if (mrsStatus.overall_status === 'APPROVED_READY_TO_ORDER') {
      const { error: mrsErr } = await supabase
        .from('material_requisitions')
        .update({ overall_status: 'TRANSMITTAL_IN_PROGRESS' })
        .eq('id', input.mrsId)
      if (mrsErr) throw new Error(`Transmittal created, but requisition update failed: ${mrsErr.message}`)
    }
    // Any other status (already TRANSMITTAL_IN_PROGRESS, READY_FOR_PURCHASE,
    // PURCHASING, ...) is left untouched — the transmittal is additive.
  }

  const { data: transmittal, error: insertErr } = await supabase
    .from('transmittal_forms')
    .insert({
      transmittal_number: trNumber,
      mrs_id: input.mrsId || null,
      transmittal_type: input.transmittalType,
      amount: input.amount,
      sender_user_id: user.id,
      sender_status: 'PENDING' as TransmittalStatus,
      receiver_user_id: input.receiverUserId,
      receiver_status: 'PENDING' as TransmittalStatus,
      notes: input.notes?.trim() || null,
    })
    .select('*')
    .single()

  if (insertErr || !transmittal) {
    throw new Error(insertErr?.message || 'Failed to create transmittal.')
  }

  await logTransmittalActivity({
    transmittalId: transmittal.id,
    transmittalNumber: trNumber,
    action: 'TRANSMITTAL_CREATED',
    performedBy: user.id,
    mrsId: input.mrsId || null,
    notes: `Transmittal ${trNumber} created. Type: ${input.transmittalType}, Amount: ₱${input.amount.toFixed(2)}`,
  })

  return { success: true, transmittal }
}

// ──────────────────────────────────────────────────────────
// Form 10 — Batch Transmittal (Plan.md §6.D)
// Up to 50 MRS under one TR-BATCH-YYYY-XXXX code.
// Single DB transaction — if one fails, all roll back.
// ──────────────────────────────────────────────────────────

export interface BatchTransmittalItem {
  mrsId: number
  amount: number
}

export async function createBatchTransmittal(params: {
  items: BatchTransmittalItem[]
  receiverUserId: string
  transmittalType: TransmittalType
  notes?: string
}) {
  const supabase = await createClient()
  const user = await getServerUser()
  if (!user) throw new Error('Session expired or invalid. Please sign in again.')

  if (!params.items.length || params.items.length > 50) {
    throw new Error('Batch transmittal must contain between 1 and 50 items.')
  }

  const normalizedItems = params.items.map(item => ({
    mrsId: Number(item.mrsId),
    amount: Number(item.amount),
  }))

  if (normalizedItems.some(item => !Number.isFinite(item.mrsId) || item.mrsId <= 0 || !Number.isFinite(item.amount) || item.amount <= 0)) {
    throw new Error('Each batch item requires a valid MRS ID and a positive amount.')
  }

  const rpcCall = supabase.rpc as unknown as (
    fnName: string,
    params: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>

  const { data: batchResult, error: batchRpcErr } = await rpcCall(
    'create_batch_transmittal_transaction',
    {
      p_items: normalizedItems,
      p_receiver_user_id: params.receiverUserId,
      p_transmittal_type: params.transmittalType,
      p_notes: params.notes?.trim() || null,
      p_sender_user_id: user.id,
    }
  )

  if (batchRpcErr || !batchResult) {
    throw new Error(batchRpcErr?.message || 'Batch transmittal insert failed — transaction rolled back.')
  }

  const payload = batchResult as unknown as {
    batch_code: string
    total_amount: number
    transmittals: Array<Record<string, unknown>>
  }

  await logTransmittalActivity({
    transmittalId: Number(payload.transmittals[0]?.id ?? 0),
    transmittalNumber: payload.batch_code,
    action: 'BATCH_TRANSMITTAL_CREATED',
    performedBy: user.id,
    notes: `Batch ${payload.batch_code}: ${normalizedItems.length} transmittals created, total ₱${Number(payload.total_amount ?? 0).toFixed(2)}`,
  })

  return {
    success: true,
    batchCode: payload.batch_code,
    transmittals: payload.transmittals ?? [],
    totalAmount: Number(payload.total_amount ?? 0),
  }
}

// ──────────────────────────────────────────────────────────
// Form 11 — Accounting Disburse Cash & Mark Sent (Plan.md §5 Form 11)
// Access: Accounting, Super Admin
// ──────────────────────────────────────────────────────────

export async function disburseCashAndMarkSent(transmittalId: number) {
  const supabase = await createClient()
  const user = await getServerUser()
  if (!user) throw new Error('Session expired or invalid. Please sign in again.')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['SUPER_ADMIN', 'ACCOUNTING'].includes(profile.role)) {
    throw new Error('Only Accounting and Super Admins can disburse transmittals.')
  }

  const { data: tr, error: trErr } = await supabase
    .from('transmittal_forms')
    .select('id, transmittal_number, mrs_id, sender_status, receiver_status, amount')
    .eq('id', transmittalId)
    .single()

  if (trErr || !tr) throw new Error('Transmittal not found.')
  if (tr.sender_status !== 'PENDING') {
    throw new Error(`Transmittal already processed (status: ${tr.sender_status}).`)
  }

  // 0012 strict chain: a transmittal can no longer be disbursed against a
  // terminal/resolved requisition.
  if (tr.mrs_id) {
    const { data: mrsCheck, error: mrsCheckErr } = await supabase
      .from('material_requisitions')
      .select('id, mrs_number, overall_status')
      .eq('id', tr.mrs_id)
      .single()

    if (mrsCheckErr || !mrsCheck) {
      throw new Error('The linked requisition no longer exists — the transmittal cannot be disbursed.')
    }
    if (['CLOSED', 'VOIDED', 'ISSUED_FROM_STOCK'].includes(mrsCheck.overall_status)) {
      throw new Error(`Requisition ${mrsCheck.mrs_number} is ${mrsCheck.overall_status} — cash cannot be disbursed against it.`)
    }
  }

  const { error: trUpdateError } = await supabase
    .from('transmittal_forms')
    .update({
      sender_status: 'SENT' as TransmittalStatus,
      sent_at: new Date().toISOString(),
    })
    .eq('id', transmittalId)

  if (trUpdateError) throw new Error(`Disbursement failed: ${trUpdateError.message}`)

  // If linked to an MRS, move it to READY_FOR_PURCHASE — forward only (0012):
  // the first disbursement advances TRANSMITTAL_IN_PROGRESS → READY_FOR_PURCHASE;
  // supplemental transmittals on an already-released MRS are additive.
  if (tr.mrs_id) {
    const { data: mrs, error: mrsErr } = await supabase
      .from('material_requisitions')
      .select('id, mrs_number, overall_status')
      .eq('id', tr.mrs_id)
      .single()

    if (mrsErr || !mrs) {
      throw new Error(`Cash disbursed, but the linked requisition could not be found: ${mrsErr?.message ?? 'unknown error'}`)
    }
    if (mrs.overall_status === 'TRANSMITTAL_IN_PROGRESS') {
      const { error: mrsUpdateError } = await supabase
        .from('material_requisitions')
        .update({ overall_status: 'READY_FOR_PURCHASE' })
        .eq('id', tr.mrs_id)

      if (mrsUpdateError) {
        throw new Error(`Cash disbursed, but the requisition could not advance to READY_FOR_PURCHASE: ${mrsUpdateError.message}`)
      }
    }
    // READY_FOR_PURCHASE / PURCHASING (supplemental) → left untouched.
  }

  await logTransmittalActivity({
    transmittalId: tr.id,
    transmittalNumber: tr.transmittal_number,
    action: 'TRANSMITTAL_DISBURSED_SENT',
    performedBy: user.id,
    mrsId: tr.mrs_id || null,
    notes: `Cash disbursed and marked SENT. Amount: ₱${Number(tr.amount).toFixed(2)}`,
  })

  return { success: true }
}

// ──────────────────────────────────────────────────────────
// Form 11 — Verify Cash & Mark Spare Change Received (Plan.md §5 Form 11)
// MRS → CLOSED, computes Net Disbursed = Initial Amount - Spare Change Returned
// ──────────────────────────────────────────────────────────

export async function verifyCashAndMarkReceived(params: {
  transmittalId: number
  spareChangeReturned: number
}) {
  const supabase = await createClient()
  const user = await getServerUser()
  if (!user) throw new Error('Session expired or invalid. Please sign in again.')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['SUPER_ADMIN', 'ACCOUNTING'].includes(profile.role)) {
    throw new Error('Only Accounting and Super Admins can verify spare change.')
  }

  const spare = Number(params.spareChangeReturned)
  if (!Number.isFinite(spare) || spare < 0) {
    throw new Error('Spare change returned must be zero or a positive number.')
  }

  const { data: tr, error: trErr } = await supabase
    .from('transmittal_forms')
    .select('id, transmittal_number, mrs_id, amount, sender_status')
    .eq('id', params.transmittalId)
    .single()

  if (trErr || !tr) throw new Error('Transmittal not found.')
  if (tr.sender_status !== 'SENT') {
    throw new Error('Transmittal must be SENT before it can be received/verified.')
  }

  const netDisbursed = Number(tr.amount) - spare
  if (spare > Number(tr.amount)) {
    throw new Error(
      `Spare change (₱${spare.toFixed(2)}) cannot exceed the disbursed amount (₱${Number(tr.amount).toFixed(2)}).`
    )
  }

  // ── 0013 Gate B — spare-change reconciliation ────────────────────────────
  // Form 14 sign-off stamped `spare_change_required` on the requisition
  // (cash disbursed − actually spent). Accounting may only close the
  // transmittal once the amount physically handed back covers that figure.
  // Under-returning is rejected; the cash is still outstanding.
  type MRSGateRow = {
    id: number
    mrs_number: string
    overall_status: string
    spare_change_required: number | null
    spare_change_returned: number | null
  }
  let mrsForGate: MRSGateRow | null = null

  // Set when migration 0013 is not deployed — the reconciliation columns
  // cannot be written and the gate is skipped for this call.
  let gateUnavailable = false

  if (tr.mrs_id) {
    // The 0013 columns only exist once that migration has been applied.
    // PostgREST rejects the whole query with 42703 when they are missing
    // (agent_handoff Rule 7), so degrade to the pre-0013 column set and skip
    // the reconciliation gate rather than crashing the action.
    let mrsGate: MRSGateRow

    const gateQuery = await supabase
      .from('material_requisitions')
      .select('id, mrs_number, overall_status, spare_change_required, spare_change_returned')
      .eq('id', tr.mrs_id)
      .single()

    if (gateQuery.error?.code === PG_UNDEFINED_COLUMN) {
      gateUnavailable = true
      const legacy = await supabase
        .from('material_requisitions')
        .select('id, mrs_number, overall_status')
        .eq('id', tr.mrs_id)
        .single()
      if (legacy.error || !legacy.data) {
        throw new Error('The linked requisition could not be loaded — spare change cannot be verified.')
      }
      mrsGate = { ...legacy.data, ...MRS_0013_DEFAULTS }
    } else {
      if (gateQuery.error || !gateQuery.data) {
        throw new Error('The linked requisition could not be loaded — spare change cannot be verified.')
      }
      mrsGate = gateQuery.data
    }

    mrsForGate = mrsGate

    const required = Number(mrsGate.spare_change_required ?? 0)
    const alreadyReturned = Number(mrsGate.spare_change_returned ?? 0)
    const totalReturned = alreadyReturned + spare
    const shortfall = required - totalReturned

    if (shortfall > SPARE_CHANGE_TOLERANCE) {
      throw new Error(
        `Spare change is short by ₱${shortfall.toFixed(2)}. Requisition ${mrsGate.mrs_number} requires ` +
        `₱${required.toFixed(2)} to be returned` +
        (alreadyReturned > 0 ? ` (₱${alreadyReturned.toFixed(2)} already recorded)` : '') +
        `, but ₱${spare.toFixed(2)} was entered. ` +
        `The transmittal cannot be closed until the full spare change is received.`
      )
    }

    if (totalReturned - required > SPARE_CHANGE_TOLERANCE && required > 0) {
      throw new Error(
        `Spare change entered (₱${totalReturned.toFixed(2)}) exceeds the ₱${required.toFixed(2)} recorded on ` +
        `requisition ${mrsGate.mrs_number}. Re-check the amount, or have the purchase actuals corrected first.`
      )
    }
  }

  const { error: trUpdateError } = await supabase
    .from('transmittal_forms')
    .update({
      receiver_status: 'RECEIVED' as TransmittalStatus,
      received_at: new Date().toISOString(),
      notes: `Spare change returned: ₱${spare.toFixed(2)}. Net Disbursed: ₱${netDisbursed.toFixed(2)}.`,
    })
    .eq('id', params.transmittalId)

  if (trUpdateError) throw new Error(`Verification failed: ${trUpdateError.message}`)

  // MRS → CLOSED (Plan.md §4.2: FULFILLED --> CLOSED after spare change verified).
  // 0012 strict chain: the requisition must be fully delivered and signed off
  // (FULFILLED) first — Accounting cannot close it while items are still being
  // purchased or in transit.
  if (tr.mrs_id && mrsForGate) {
    const mrs = mrsForGate
    if (mrs.overall_status !== 'FULFILLED') {
      throw new Error(
        `Requisition ${mrs.mrs_number} is still "${mrs.overall_status}". ` +
        `Delivery must be verified by the requester's department (Form 14) before Accounting can record spare change and close it.`
      )
    }

    // Record the returned cash BEFORE closing so SQL Gate B (0013) sees a
    // settled balance on the status write.
    const totalReturned = Number((Number(mrs.spare_change_returned ?? 0) + spare).toFixed(2))

    const { error: mrsCloseError } = await supabase
      .from('material_requisitions')
      .update(
        gateUnavailable
          ? { overall_status: 'CLOSED', spare_change_amount: spare }
          : {
              overall_status: 'CLOSED',
              spare_change_amount: spare,
              spare_change_returned: totalReturned,
            }
      )
      .eq('id', tr.mrs_id)

    if (mrsCloseError) {
      throw new Error(`Spare change verified, but the requisition could not be closed: ${mrsCloseError.message}`)
    }

    await logTransmittalActivity({
      transmittalId: tr.id,
      transmittalNumber: tr.transmittal_number,
      action: 'MRS_SPARE_CHANGE_RETURNED',
      performedBy: user.id,
      mrsId: tr.mrs_id,
      notes:
        `Spare change of ₱${spare.toFixed(2)} received and reconciled against the ` +
        `₱${Number(mrs.spare_change_required ?? 0).toFixed(2)} required on ${mrs.mrs_number}.`,
      metadata: {
        spare_change_required: Number(mrs.spare_change_required ?? 0),
        spare_change_returned: totalReturned,
      },
    })
  }

  // If spare change > 0, create a SPARE_CHANGE_RETURN transmittal
  if (params.spareChangeReturned > 0 && tr.mrs_id) {
    const currentYear = new Date().getFullYear()
    const { data: returnTrNum, error: returnRpcErr } = await supabase.rpc(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'next_reference_number' as any,
      { p_prefix: 'TR', p_year: currentYear }
    )
    if (returnRpcErr || !returnTrNum) {
      throw new Error(
        returnRpcErr?.message ||
        'Reference numbering service is unavailable — the spare change return transmittal could not be generated.'
      )
    }
    const returnNumber = returnTrNum as unknown as string

    await supabase
      .from('transmittal_forms')
      .insert({
        transmittal_number: returnNumber,
        mrs_id: tr.mrs_id,
        transmittal_type: 'SPARE_CHANGE_RETURN' as TransmittalType,
        amount: params.spareChangeReturned,
        sender_user_id: user.id,
        sender_status: 'RECEIVED' as TransmittalStatus,
        sent_at: new Date().toISOString(),
        receiver_user_id: user.id,
        receiver_status: 'RECEIVED' as TransmittalStatus,
        received_at: new Date().toISOString(),
        notes: `Auto-generated spare change return for ₱${params.spareChangeReturned.toFixed(2)}.`,
      })
  }

  await logTransmittalActivity({
    transmittalId: tr.id,
    transmittalNumber: tr.transmittal_number,
    action: 'TRANSMITTAL_VERIFIED_RECEIVED',
    performedBy: user.id,
    mrsId: tr.mrs_id || null,
    notes: `Spare change: ₱${params.spareChangeReturned.toFixed(2)}, Net: ₱${netDisbursed.toFixed(2)}. MRS → CLOSED.`,
  })

  return { success: true, netDisbursed }
}

// ──────────────────────────────────────────────────────────
// Form 12 — Front Desk COD Disbursement (Plan.md §5 Form 12 Mode 1)
// Access: Front Desk, Super Admin
// ──────────────────────────────────────────────────────────

export async function fdCodDisbursement(params: {
  mrsId: number
  amount: number
  courierTrackingBarcode: string
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

  if (!profile || !['SUPER_ADMIN', 'FRONT_DESK'].includes(profile.role)) {
    throw new Error('Only Front Desk and Super Admins can process COD disbursements.')
  }

  const currentYear = new Date().getFullYear()
  const { data: trNum, error: trNumErr } = await supabase.rpc(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'next_reference_number' as any,
    { p_prefix: 'TR', p_year: currentYear }
  )
  if (trNumErr || !trNum) {
    throw new Error(
      trNumErr?.message ||
      'Reference numbering service is unavailable. Please retry — the COD disbursement was not created.'
    )
  }
  const trNumber = trNum as unknown as string

  // Fetch the requester from MRS to set as receiver
  const { data: mrs } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, requester_id')
    .eq('id', params.mrsId)
    .single()

  if (!mrs) throw new Error('MRS not found.')

  const { data: transmittal, error: insertErr } = await supabase
    .from('transmittal_forms')
    .insert({
      transmittal_number: trNumber,
      mrs_id: params.mrsId,
      transmittal_type: 'FD_REVOLVING_DISBURSEMENT' as TransmittalType,
      amount: params.amount,
      sender_user_id: user.id,
      sender_status: 'SENT' as TransmittalStatus,
      sent_at: new Date().toISOString(),
      receiver_user_id: mrs.requester_id,
      receiver_status: 'PENDING' as TransmittalStatus,
      courier_tracking_barcode: params.courierTrackingBarcode,
      notes: params.notes?.trim() || null,
    })
    .select('*')
    .single()

  if (insertErr || !transmittal) {
    throw new Error(insertErr?.message || 'Failed to create COD disbursement.')
  }

  // Mark delivery as DELIVERED on the MRS
  await supabase
    .from('material_requisitions')
    .update({ delivery_status: 'DELIVERED', revolving_fund_used: true })
    .eq('id', params.mrsId)

  await logTransmittalActivity({
    transmittalId: transmittal.id,
    transmittalNumber: trNumber,
    action: 'FD_COD_DISBURSEMENT',
    performedBy: user.id,
    mrsId: params.mrsId,
    notes: `Front Desk COD disbursement: ₱${params.amount.toFixed(2)}, barcode: ${params.courierTrackingBarcode}`,
  })

  return { success: true, transmittal }
}

// ──────────────────────────────────────────────────────────
// Form 12 — Next-Day FD Float Replenishment (Plan.md §5 Form 12 Mode 2)
// Access: Budget Officer, Super Admin
// ──────────────────────────────────────────────────────────

export async function fdReplenishFloat(params: {
  amount: number
  receiverUserId: string // The Front Desk user
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

  if (!profile || !['SUPER_ADMIN', 'BUDGET_OFFICER'].includes(profile.role)) {
    throw new Error('Only Budget Officers and Super Admins can replenish the FD float.')
  }

  const currentYear = new Date().getFullYear()
  const { data: trNum, error: trNumErr } = await supabase.rpc(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'next_reference_number' as any,
    { p_prefix: 'TR', p_year: currentYear }
  )
  if (trNumErr || !trNum) {
    throw new Error(
      trNumErr?.message ||
      'Reference numbering service is unavailable. Please retry — the float replenishment was not created.'
    )
  }
  const trNumber = trNum as unknown as string

  const { data: transmittal, error: insertErr } = await supabase
    .from('transmittal_forms')
    .insert({
      transmittal_number: trNumber,
      mrs_id: null,
      transmittal_type: 'FD_REVOLVING_REPLENISHMENT' as TransmittalType,
      amount: params.amount,
      sender_user_id: user.id,
      sender_status: 'SENT' as TransmittalStatus,
      sent_at: new Date().toISOString(),
      receiver_user_id: params.receiverUserId,
      receiver_status: 'PENDING' as TransmittalStatus,
      notes: params.notes?.trim() || `FD Float replenishment: ₱${params.amount.toFixed(2)}`,
    })
    .select('*')
    .single()

  if (insertErr || !transmittal) {
    throw new Error(insertErr?.message || 'Failed to replenish FD float.')
  }

  await logTransmittalActivity({
    transmittalId: transmittal.id,
    transmittalNumber: trNumber,
    action: 'FD_FLOAT_REPLENISHMENT',
    performedBy: user.id,
    notes: `FD revolving float replenished: ₱${params.amount.toFixed(2)}`,
  })

  return { success: true, transmittal }
}
