'use server'

import { createClient, getServerUser } from '@/lib/supabase/server'
import { logTransmittalActivity } from '@/lib/notifications/dispatcher'
import {
  MRS_0013_DEFAULTS,
  PG_UNDEFINED_COLUMN,
  SPARE_CHANGE_TOLERANCE,
  TRANSMITTABLE_MRS_STATUSES,
  DISBURSABLE_MRS_STATUSES,
  FD_COD_MRS_STATUSES,
  isDeliveryVerified,
} from '@/lib/status-machines'
import type { TransmittalType, TransmittalStatus, UserRole } from '@/types/index'

/**
 * Validate a transmittal's custody target (audit §B6).
 *
 * Rule 3's dual confirmation hangs on `receiver_user_id`: if it names a
 * deactivated account (Rule 5) or an id that no longer exists, cash is handed to
 * somebody who can never confirm receipt and the chain dead-ends. §5 Form 10
 * lists *every* active account in the receiver dropdown with no role filter, so
 * no role is enforced by default — `expectedRole` is only passed where the flow
 * itself is role-specific (Form 12 float replenishment → Front Desk).
 */
async function requireActiveReceiver(
  supabase: Awaited<ReturnType<typeof createClient>>,
  receiverUserId: string,
  expectedRole?: UserRole
) {
  if (!receiverUserId) {
    throw new Error('Select the account that will take custody of this cash.')
  }

  const { data: receiver } = await supabase
    .from('users')
    .select('id, full_name, role, account_status')
    .eq('id', receiverUserId)
    .maybeSingle()

  if (!receiver) {
    throw new Error('The selected receiver account no longer exists.')
  }

  if (receiver.account_status !== 'ACTIVE') {
    throw new Error(
      `${receiver.full_name ?? 'The selected receiver'} cannot take custody of cash — their account is ` +
      `${receiver.account_status}, not ACTIVE (Rule 5).`
    )
  }

  if (expectedRole && receiver.role !== expectedRole) {
    throw new Error(
      `${receiver.full_name ?? 'The selected receiver'} is a ${receiver.role}, and only a ${expectedRole} account can receive this cash.`
    )
  }

  return receiver as {
    id: string
    full_name: string | null
    role: UserRole
    account_status: string
  }
}

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

  await requireActiveReceiver(supabase, input.receiverUserId)

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
      .select('id, mrs_number, overall_status, allocated_budget, total_actual_spent')
      .eq('id', input.mrsId)
      .single()

    if (mrsFetchErr || !mrsStatus) {
      throw new Error('The linked requisition no longer exists.')
    }

    // CASH CHAIN: no budget transmittal before Owner approval (no allocated
    // budget yet) and none after the purchase is already done (actuals saved /
    // shipped / fulfilled / closed) — otherwise cash could be committed
    // against a requisition that should never have received it.
    if (!(TRANSMITTABLE_MRS_STATUSES as readonly string[]).includes(mrsStatus.overall_status)) {
      throw new Error(
        `Requisition ${mrsStatus.mrs_number} is "${mrsStatus.overall_status}" and cannot receive a new cash transmittal. ` +
        `Cash transmittals are only issued while the requisition is ${TRANSMITTABLE_MRS_STATUSES.join(', ')}.`
      )
    }

    // CASH CHAIN: reject over-disbursement up-front — a transmittal (or the
    // running total of transmittals) that pushes cash received above the
    // Owner-allocated budget plus recorded shipping is a financial leak.
    // SPARE_CHANGE_RETURN is exempt: it carries cash BACK, not out.
    const allocated = Number(mrsStatus.allocated_budget ?? 0)
    const spent = Number(mrsStatus.total_actual_spent ?? 0)
    const outlayCeiling = allocated + spent
    // B10: this ceiling used to disarm itself when it was zero (`&& outlayCeiling
    // > 0`), so a requisition with no Owner-approved budget could receive
    // unlimited cash transmittals. A ceiling of 0 is a real ceiling — no approved
    // budget, no outlay — so it now fails closed like every other cash gate.
    if (input.transmittalType !== 'SPARE_CHANGE_RETURN') {
      if (outlayCeiling <= 0) {
        throw new Error(
          `${mrsStatus.mrs_number} has no Owner-approved budget to issue cash against (₱0.00 allocated). ` +
          `Record the canvass and the Owner's decision with an approved budget on Form 8 first.`
        )
      }

      const { data: existingTrs } = await supabase
        .from('transmittal_forms')
        .select('amount, transmittal_type')
        .eq('mrs_id', input.mrsId)
        .not('transmittal_type', 'eq', 'SPARE_CHANGE_RETURN')
      const alreadyIssued = (existingTrs ?? []).reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
      if (alreadyIssued + Number(input.amount) - outlayCeiling > 0.01) {
        throw new Error(
          `Cannot issue ₱${Number(input.amount).toFixed(2)} — ${mrsStatus.mrs_number} has an outlay ceiling of ` +
          `₱${outlayCeiling.toFixed(2)} (budget ₱${allocated.toFixed(2)} + receipts-to-reconcile ₱${spent.toFixed(2)}) ` +
          `and ₱${alreadyIssued.toFixed(2)} is already issued against it.`
        )
      }
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

  // Verify sender role — the batch RPC writes straight into transmittal_forms,
  // so this action is the only gate between a direct call and up to 50 cash
  // records (audit §A2).
  const { data: batchProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!batchProfile || !['SUPER_ADMIN', 'BUDGET_OFFICER'].includes(batchProfile.role)) {
    throw new Error('Only Budget Officers and Super Admins can create transmittals.')
  }

  if (!params.items.length || params.items.length > 50) {
    throw new Error('Batch transmittal must contain between 1 and 50 items.')
  }

  await requireActiveReceiver(supabase, params.receiverUserId)

  const normalizedItems = params.items.map(item => ({
    mrsId: Number(item.mrsId),
    amount: Number(item.amount),
  }))

  if (normalizedItems.some(item => !Number.isFinite(item.mrsId) || item.mrsId <= 0 || !Number.isFinite(item.amount) || item.amount <= 0)) {
    throw new Error('Each batch item requires a valid MRS ID and a positive amount.')
  }

  // CASH CHAIN: the batch RPC does not validate requisition status or the
  // cumulative disbursement total, so the app gate below is the primary
  // enforcement (until migration 0015 adds the DB-level checks). A batch item
  // against an unapproved / already-purchased / over-budget requisition is a
  // financial leak — reject it before the transaction commits.
  const uniqueIds = [...new Set(normalizedItems.map(i => i.mrsId))]
  const { data: batchMrsRows, error: batchMrsErr } = await supabase
    .from('material_requisitions')
    .select('id, mrs_number, overall_status, allocated_budget, total_actual_spent')
    .in('id', uniqueIds)
  if (batchMrsErr || !batchMrsRows) {
    throw new Error(batchMrsErr?.message || 'Could not load the linked requisitions for the batch.')
  }
  const mrsById = new Map(batchMrsRows.map(m => [m.id, m]))
  if (uniqueIds.some(id => !mrsById.has(id))) {
    throw new Error('One or more linked requisitions no longer exist — batch aborted.')
  }

  for (const item of normalizedItems) {
    const mrs = mrsById.get(item.mrsId)!
    if (!(TRANSMITTABLE_MRS_STATUSES as readonly string[]).includes(mrs.overall_status)) {
      throw new Error(
        `Batch item ${mrs.mrs_number} is "${mrs.overall_status}" and cannot receive a new cash transmittal. ` +
        `Only ${TRANSMITTABLE_MRS_STATUSES.join(', ')} may be included in a batch.`
      )
    }
  }

  // Cumulative outlay per requisition (budget + receipts-to-reconcile) — the RPC
  // has no such check, so a batch could otherwise over-issue cash silently.
  const { data: priorFlow } = await supabase
    .from('transmittal_forms')
    .select('mrs_id, amount')
    .in('mrs_id', uniqueIds)
    .neq('transmittal_type', 'SPARE_CHANGE_RETURN')
  const flowByMRS = new Map<number, number>()
  for (const t of priorFlow ?? []) {
    if (t.mrs_id === null || t.mrs_id === undefined) continue
    flowByMRS.set(t.mrs_id, (flowByMRS.get(t.mrs_id) ?? 0) + (Number(t.amount) || 0))
  }
  if (params.transmittalType !== 'SPARE_CHANGE_RETURN') {
    for (const item of normalizedItems) {
      const mrs = mrsById.get(item.mrsId)!
      const allocated = Number(mrs.allocated_budget ?? 0)
      const spent = Number(mrs.total_actual_spent ?? 0)
      const ceiling = allocated + spent
      // B10: `continue` here silently dropped the item out of the ceiling check,
      // so a zero-budget requisition could be batch-funded without limit.
      if (ceiling <= 0) {
        throw new Error(
          `Batch item ${mrs.mrs_number} has no Owner-approved budget to issue cash against (₱0.00 allocated). ` +
          `Record the Owner's decision with an approved budget on Form 8 first — the whole batch is rejected until then.`
        )
      }
      const existing = flowByMRS.get(item.mrsId) ?? 0
      if (existing + item.amount - ceiling > 0.01) {
        throw new Error(
          `Batch item ${mrs.mrs_number} would exceed its outlay ceiling (₱${ceiling.toFixed(2)}): ` +
          `₱${existing.toFixed(2)} already issued + ₱${Number(item.amount).toFixed(2)}.`
        )
      }
    }
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
    // CASH CHAIN: cash may only be SENT while the requisition is within the
    // disbursement window — no disbursement before Owner approval, none after
    // the purchase is already done (actuals saved / shipped / fulfilled).
    if (!(DISBURSABLE_MRS_STATUSES as readonly string[]).includes(mrsCheck.overall_status)) {
      throw new Error(
        `Cash cannot be disbursed against ${mrsCheck.mrs_number} while it is "${mrsCheck.overall_status}". ` +
        `Disbursement is only allowed from ${DISBURSABLE_MRS_STATUSES.join(', ')}.`
      )
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

/**
 * Internal implementation — throws on any failure.
 *
 * Do NOT call from a client component: in production Next.js redacts a thrown
 * Server Action error into an opaque digest ("Minified React error #441"), so
 * the operator sees no reason for the refusal. Use the exported
 * `verifyCashAndMarkReceived()` wrapper below, which converts the throw into a
 * structured, displayable result.
 */
async function verifyCashAndMarkReceivedImpl(params: {
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
    // Present since 0001, so it is safe to select on pre-0013 deployments too.
    requester_verification: string | null
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
      .select(
        'id, mrs_number, overall_status, requester_verification, spare_change_required, spare_change_returned'
      )
      .eq('id', tr.mrs_id)
      .single()

    if (gateQuery.error?.code === PG_UNDEFINED_COLUMN) {
      gateUnavailable = true
      const legacy = await supabase
        .from('material_requisitions')
        .select('id, mrs_number, overall_status, requester_verification')
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

    // ── 0014 Gate C — delivery sign-off must come first ────────────────────
    // Checked BEFORE Gate B, because `spare_change_required` is only stamped
    // by Form 14. Without sign-off it is still the 0.00 default, so Gate B
    // would compare 0 − 0, pass, and let Accounting close the requisition with
    // the spare change never computed and never collected.
    if (!isDeliveryVerified(mrsGate)) {
      throw new Error(
        `Requisition ${mrsGate.mrs_number} has not been verified as delivered by the requester ` +
        `(currently "${mrsGate.requester_verification ?? 'PENDING_DELIVERY'}"). ` +
        `The requester's department must sign off the delivery (Form 14) first — that step computes ` +
        `how much spare change is owed. Closing now would lose it.`
      )
    }

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

    // B7: the over-return bound must apply when nothing is owed too. Gating it on
    // `required > 0` let Accounting record ANY amount up to the transmittal as
    // returned spare change on a requisition owing ₱0.00 — inflating
    // `spare_change_returned` (which understates Form 17's net disbursed) and
    // minting a SPARE_CHANGE_RETURN for cash that was never owed. The
    // `gateUnavailable` branch stays permissive on purpose: there `required` is a
    // fabricated MRS_0013_DEFAULTS value, not a real balance, and §10.5 requires
    // the pre-0013 path to keep working.
    if (!gateUnavailable && totalReturned - required > SPARE_CHANGE_TOLERANCE) {
      throw new Error(
        `Spare change entered (₱${totalReturned.toFixed(2)}) exceeds the ₱${required.toFixed(2)} recorded on ` +
        `requisition ${mrsGate.mrs_number}. Re-check the amount, or have the purchase actuals corrected first.`
      )
    }
  }

  // ── WRITE ORDER IS LOAD-BEARING (0013) ───────────────────────────────────
  // The requisition MUST be settled & closed BEFORE the transmittal is marked
  // RECEIVED. `trg_guard_transmittal_receipt` re-reads
  // material_requisitions.spare_change_returned and rejects the receipt while
  // the MRS still owes money — so writing the transmittal first would always
  // trip Gate B on the very requisition this call is settling (the two gates
  // would block each other and nothing could ever be closed).
  if (tr.mrs_id && mrsForGate) {
    const mrs = mrsForGate
    if (mrs.overall_status !== 'FULFILLED') {
      throw new Error(
        `Requisition ${mrs.mrs_number} is still "${mrs.overall_status}". ` +
        `Delivery must be verified by the requester's department (Form 14) before Accounting can record spare change and close it.`
      )
    }

    // Record the returned cash in the SAME update as the close, so the MRS
    // guard sees NEW.spare_change_returned already settled on the status write.
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
      throw new Error(`The requisition could not be closed: ${mrsCloseError.message}`)
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

  // Now that the requisition is settled, the transmittal receipt passes
  // `trg_guard_transmittal_receipt` (Gate B re-reads the MRS balance).
  const { error: trUpdateError } = await supabase
    .from('transmittal_forms')
    .update({
      receiver_status: 'RECEIVED' as TransmittalStatus,
      received_at: new Date().toISOString(),
      notes: `Spare change returned: ₱${spare.toFixed(2)}. Net Disbursed: ₱${netDisbursed.toFixed(2)}.`,
    })
    .eq('id', params.transmittalId)

  if (trUpdateError) throw new Error(`Verification failed: ${trUpdateError.message}`)

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

export interface VerifyCashResult {
  success: boolean
  netDisbursed?: number
  error?: string
}

/**
 * Form 11 — Verify Cash & Mark Spare Change Received.
 *
 * Returns a structured result instead of throwing so the Accounting UI can
 * render the actual reason (e.g. "Spare change is short by ₱360.00") rather
 * than React error #441, which is all a thrown Server Action error surfaces
 * once the app is built for production.
 */
export async function verifyCashAndMarkReceived(params: {
  transmittalId: number
  spareChangeReturned: number
}): Promise<VerifyCashResult> {
  try {
    return await verifyCashAndMarkReceivedImpl(params)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed.'
    console.error(JSON.stringify({
      level: 'error',
      source: 'verifyCashAndMarkReceived',
      transmittal_id: params.transmittalId,
      spare_change_returned: params.spareChangeReturned,
      message,
      timestamp: new Date().toISOString(),
    }))
    return { success: false, error: message }
  }
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

  // CASH CHAIN: a COD advance is cash leaving the revolving float — it must be
  // a positive, finite amount and carry a courier barcode for the paper trail.
  const amount = Number(params.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('COD advance amount must be greater than zero.')
  }
  if (!params.courierTrackingBarcode?.trim()) {
    throw new Error('A courier tracking barcode is required for a COD advance.')
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
    .select('id, mrs_number, requester_id, overall_status, is_online_purchase, total_estimated_cost')
    .eq('id', params.mrsId)
    .single()

  if (!mrs) throw new Error('MRS not found.')

  // CASH CHAIN: the revolving float only advances cash for a genuine online /
  // COD order whose purchase is in flight. Handing float cash to an arbitrary
  // requisition (or one already fulfilled) leaks the float.
  if (!mrs.is_online_purchase) {
    throw new Error(
      `Requisition ${mrs.mrs_number} is not an online/COD purchase — the FD revolving float can only advance cash for online orders.`
    )
  }
  if (!(FD_COD_MRS_STATUSES as readonly string[]).includes(mrs.overall_status)) {
    throw new Error(
      `Requisition ${mrs.mrs_number} is "${mrs.overall_status}" and cannot receive a COD advance. ` +
      `COD advances are only released while the order is ${FD_COD_MRS_STATUSES.join(', ')}.`
    )
  }
  const estimated = Number(mrs.total_estimated_cost ?? 0)
  if (estimated > 0 && amount - estimated > 0.01) {
    throw new Error(
      `COD advance of ₱${amount.toFixed(2)} exceeds ${mrs.mrs_number}'s estimated order total of ₱${estimated.toFixed(2)}.`
    )
  }

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

  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error('Float replenishment amount must be greater than zero.')
  }

  // Form 12 Mode 2 replenishes the float into a Front Desk account's custody; the
  // Form 12 UI lists ACTIVE FRONT_DESK users only, so enforce the same here
  // (audit §B6) — cash parked with a deactivated or non-FD account can never be
  // confirmed under Rule 3.
  await requireActiveReceiver(supabase, params.receiverUserId, 'FRONT_DESK')

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
