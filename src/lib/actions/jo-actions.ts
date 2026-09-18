'use server'

import { createClient } from '@/lib/supabase/server'
import { logJOActivity } from '@/lib/notifications/dispatcher'
import {
  ACCEPTABLE_JO_STATUSES,
  CANCELLABLE_JO_STATUSES,
  CLOSEABLE_JO_STATUSES,
  COMPLETABLE_JO_STATUSES,
  JO_CLOSE_ROLES,
  REOPENABLE_JO_STATUSES,
  assertJOTransition,
} from '@/lib/status-machines'
import type { JOStatus, JOPriority, UserRole } from '@/types/index'

/** Form field limits — mirror the database column sizes (Plan §3.2). */
export const JO_FIELD_LIMITS = {
  title: 200,
  location: 150,
  description: 2000,
} as const

export interface CreateJobOrderInput {
  title: string
  location: string
  description: string
  priority: JOPriority
  photoUrls?: string[]
}

/**
 * Form 1 — Create a new Job Order (Plan.md §5 Form 1)
 */
export async function createJobOrder(input: CreateJobOrderInput) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new Error('Authentication required.')
  }

  const currentYear = new Date().getFullYear()

  // Validate against column limits before touching the database (§3.2)
  if (input.title.trim().length > JO_FIELD_LIMITS.title) {
    throw new Error(`Title must be ${JO_FIELD_LIMITS.title} characters or fewer.`)
  }
  if (input.location.trim().length > JO_FIELD_LIMITS.location) {
    throw new Error(`Location must be ${JO_FIELD_LIMITS.location} characters or fewer.`)
  }
  if (input.description.trim().length > JO_FIELD_LIMITS.description) {
    throw new Error(`Description must be ${JO_FIELD_LIMITS.description} characters or fewer.`)
  }

  // Generate atomic reference number using next_reference_number('JO', year)
  // Plan.md §3.4 / Addendum guardrail #4 (never use SELECT COUNT(*)+1).
  // NOTE: no random fallback — a non-atomic number would break the
  // JO-YYYY-NNNNNN ledger sequence and could collide under concurrency.
  const { data: generatedNumber, error: rpcError } = await supabase.rpc(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'next_reference_number' as any,
    { p_prefix: 'JO', p_year: currentYear }
  )

  if (rpcError || !generatedNumber) {
    throw new Error(
      rpcError?.message ||
      'Reference numbering service is unavailable. Please retry — your ticket was not created.'
    )
  }

  const joNumber = generatedNumber as unknown as string

  // Insert Job Order row
  const { data: newJO, error: insertError } = await supabase
    .from('job_orders')
    .insert({
      jo_number: joNumber,
      title: input.title.trim(),
      location: input.location.trim(),
      description: input.description.trim(),
      priority: input.priority,
      status: 'PENDING_ASSESSMENT',
      requester_id: user.id,
      revision_suffix: 0,
      reopen_count: 0,
    })
    .select('*')
    .single()

  if (insertError || !newJO) {
    throw new Error(insertError?.message || 'Failed to create Job Order.')
  }

  // Persist site photos to attachments table (§3.2 table 9 / Form 1 spec)
  if (input.photoUrls && input.photoUrls.length > 0) {
    const attachmentRecords = input.photoUrls.map((url) => ({
      context: 'JO_SITE_PHOTO' as const,
      entity_type: 'job_order',
      entity_id: newJO.id,
      file_url: url,
      uploaded_by: user.id,
    }))

    const { error: attachError } = await supabase
      .from('attachments')
      .insert(attachmentRecords)

    if (attachError) {
      console.warn('Failed to insert attachments records:', attachError)
    }
  }

  // Append structured audit log via dispatcher (§2.3)
  await logJOActivity({
    joId: newJO.id,
    joNumber: newJO.jo_number,
    action: 'JOB_ORDER_CREATED',
    performedBy: user.id,
    notes: `Created with priority ${input.priority} at ${input.location}`,
  })

  return { success: true, jo: newJO }
}

/**
 * Form 2 — Cancel Request (Plan.md §0.7 & §5 Form 2)
 * Enabled while PENDING_ASSESSMENT, IN_PROGRESS, or AWAITING_MRS_APPROVAL.
 * Triggers cascade_jo_cancellation() via database trigger.
 */
export async function cancelJobOrder(joId: number, reason: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('Authentication required.')

  // Fetch current status to verify cancellation eligibility
  const { data: current, error: fetchError } = await supabase
    .from('job_orders')
    .select('id, jo_number, status')
    .eq('id', joId)
    .single()

  if (fetchError || !current) throw new Error('Job order not found.')

  assertJOTransition(current.status as JOStatus, 'CANCELLED', current.jo_number)
  if (!CANCELLABLE_JO_STATUSES.includes(current.status as JOStatus)) {
    throw new Error(`Cannot cancel a Job Order in "${current.status}" status.`)
  }

  // Update status to CANCELLED — this triggers cascade_jo_cancellation() (§3.5).
  // Cancellation metadata is persisted for the Form 2 audit display; the
  // database trigger fills in cancelled_at/cancelled_by when missing.
  const { error: updateError } = await supabase
    .from('job_orders')
    .update({
      status: 'CANCELLED',
      cancellation_reason: reason?.trim() || null,
      cancelled_at: new Date().toISOString(),
      cancelled_by: user.id,
    })
    .eq('id', joId)

  if (updateError) throw updateError

  await logJOActivity({
    joId: current.id,
    joNumber: current.jo_number,
    action: 'JOB_ORDER_CANCELLED',
    performedBy: user.id,
    notes: reason || 'Cancelled by requester/manager',
  })

  return { success: true }
}

/**
 * Form 2 — Issue Still Persists (Reopen Request) (Plan.md §0.10 & §5 Form 2)
 * Increments revision_suffix and reopen_count ON THE SAME ROW.
 * Sets REOPENED_UNRESOLVED (first reopen) or CRITICAL_REOPEN_ESCALATED (reopen_count >= 2).
 */
export async function reopenJobOrder(params: {
  joId: number
  notes: string
  photoUrl?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('Authentication required.')

  const { data: current, error: fetchError } = await supabase
    .from('job_orders')
    .select('id, jo_number, status, revision_suffix, reopen_count')
    .eq('id', params.joId)
    .single()

  if (fetchError || !current) throw new Error('Job order not found.')

  if (!REOPENABLE_JO_STATUSES.includes(current.status as JOStatus)) {
    throw new Error('Can only reopen a Job Order that is currently COMPLETED.')
  }

  const nextReopenCount = (current.reopen_count ?? 0) + 1
  const nextRevisionSuffix = (current.revision_suffix ?? 0) + 1

  // Escalation threshold (Plan.md §0.10): reopen_count >= 2 sets CRITICAL_REOPEN_ESCALATED
  const nextStatus = nextReopenCount >= 2
    ? 'CRITICAL_REOPEN_ESCALATED'
    : 'REOPENED_UNRESOLVED'

  // Update SAME row — locks out prior technician by clearing assignee_id (§5 Form 2)
  const { error: updateError } = await supabase
    .from('job_orders')
    .update({
      status: nextStatus,
      reopen_count: nextReopenCount,
      revision_suffix: nextRevisionSuffix,
      assignee_id: null, // Unassign previous tech
    })
    .eq('id', params.joId)

  if (updateError) throw updateError

  // If reopen photo provided, write into attachments table with context 'JO_REOPEN_PHOTO'
  if (params.photoUrl) {
    await supabase.from('attachments').insert({
      context: 'JO_REOPEN_PHOTO',
      entity_type: 'job_order',
      entity_id: params.joId,
      file_url: params.photoUrl,
      uploaded_by: user.id,
    })
  }

  await logJOActivity({
    joId: current.id,
    joNumber: current.jo_number,
    action: nextStatus === 'CRITICAL_REOPEN_ESCALATED' ? 'CRITICAL_ESCALATION' : 'JOB_ORDER_REOPENED',
    performedBy: user.id,
    notes: `Reopen #${nextReopenCount} (Rev -${String(nextRevisionSuffix).padStart(2, '0')}): ${params.notes}`,
  })

  return { success: true, status: nextStatus, reopenCount: nextReopenCount }
}

/**
 * Form 3 — Accept Request (Plan.md §5 Form 3)
 * Maintenance technician or manager accepts PENDING_ASSESSMENT JO.
 * Sets status = 'IN_PROGRESS', records started_at.
 */
export async function acceptJobOrder(joId: number, technicianId?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('Authentication required.')

  const assignee = technicianId || user.id

  const { data: current, error: fetchError } = await supabase
    .from('job_orders')
    .select('id, jo_number, status')
    .eq('id', joId)
    .single()

  if (fetchError || !current) throw new Error('Job order not found.')
  if (!ACCEPTABLE_JO_STATUSES.includes(current.status as JOStatus)) {
    throw new Error(`Cannot accept a Job Order in "${current.status}" status.`)
  }

  const { error: updateError } = await supabase
    .from('job_orders')
    .update({
      status: 'IN_PROGRESS',
      assignee_id: assignee,
      started_at: new Date().toISOString(),
    })
    .eq('id', joId)

  if (updateError) throw updateError

  await logJOActivity({
    joId: current.id,
    joNumber: current.jo_number,
    action: 'JOB_ORDER_ACCEPTED',
    performedBy: user.id,
    notes: `Accepted and assigned to technician`,
  })

  return { success: true }
}

/**
 * Form 3 — Mark Done (Plan.md §5 Form 3)
 * Sets status = 'COMPLETED', records completed_at.
 *
 * Allowed from IN_PROGRESS, REOPENED_UNRESOLVED, CRITICAL_REOPEN_ESCALATED,
 * and MATERIALS_RECEIVED (0011 — materials arrived, work finished).
 */
export async function markJobOrderDone(joId: number, completionNotes?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('Authentication required.')

  const { data: current, error: fetchError } = await supabase
    .from('job_orders')
    .select('id, jo_number, status')
    .eq('id', joId)
    .single()

  if (fetchError || !current) throw new Error('Job order not found.')
  assertJOTransition(current.status as JOStatus, 'COMPLETED', current.jo_number)
  if (!COMPLETABLE_JO_STATUSES.includes(current.status as JOStatus)) {
    throw new Error(`Cannot complete a Job Order in "${current.status}" status.`)
  }

  const { error: updateError } = await supabase
    .from('job_orders')
    .update({
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
    })
    .eq('id', joId)

  if (updateError) throw updateError

  await logJOActivity({
    joId: current.id,
    joNumber: current.jo_number,
    action: 'JOB_ORDER_COMPLETED',
    performedBy: user.id,
    notes: completionNotes || 'Work marked complete by technician',
  })

  return { success: true }
}

/**
 * Form 4 — Re-assign Senior Technician for Escalated JO (Plan.md §5 Form 4)
 */
export async function reassignEscalatedJobOrder(params: {
  joId: number
  seniorTechnicianId: string
  reassignmentNotes: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('Authentication required.')

  const { data: current, error: fetchError } = await supabase
    .from('job_orders')
    .select('id, jo_number, status, reopen_count')
    .eq('id', params.joId)
    .single()

  if (fetchError || !current) throw new Error('Job order not found.')
  const allowedStatuses = ['REOPENED_UNRESOLVED', 'CRITICAL_REOPEN_ESCALATED']
  if (!allowedStatuses.includes(current.status)) {
    throw new Error(`Cannot reassign a Job Order in "${current.status}" status.`)
  }

  const { error: updateError } = await supabase
    .from('job_orders')
    .update({
      assignee_id: params.seniorTechnicianId,
      started_at: new Date().toISOString(),
    })
    .eq('id', params.joId)

  if (updateError) throw updateError

  await logJOActivity({
    joId: current.id,
    joNumber: current.jo_number,
    action: 'ESCALATION_REASSIGNED',
    performedBy: user.id,
    notes: `Reassigned to senior technician: ${params.reassignmentNotes}`,
  })

  return { success: true }
}

/**
 * Form 2 — Close Job Order (0011 enhancement)
 * Final acceptance: COMPLETED / MATERIALS_RECEIVED -> CLOSED.
 * Manager or Super Admin only. CLOSED is terminal — a closed ticket can no
 * longer be reopened, so the caller must confirm intent.
 */
export async function closeJobOrder(joId: number, closureNotes?: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) throw new Error('Authentication required.')

  // Role gate: final close is a managerial decision
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !JO_CLOSE_ROLES.includes(profile.role as UserRole)) {
    throw new Error('Only Managers and Super Admins can close a Job Order.')
  }

  const { data: current, error: fetchError } = await supabase
    .from('job_orders')
    .select('id, jo_number, status')
    .eq('id', joId)
    .single()

  if (fetchError || !current) throw new Error('Job order not found.')

  assertJOTransition(current.status as JOStatus, 'CLOSED', current.jo_number)
  if (!CLOSEABLE_JO_STATUSES.includes(current.status as JOStatus)) {
    throw new Error(
      `Cannot close a Job Order in "${current.status}" status. Only COMPLETED or MATERIALS_RECEIVED tickets can be closed.`
    )
  }

  const { error: updateError } = await supabase
    .from('job_orders')
    .update({
      status: 'CLOSED',
      closed_at: new Date().toISOString(),
      closed_by: user.id,
    })
    .eq('id', joId)

  if (updateError) throw updateError

  await logJOActivity({
    joId: current.id,
    joNumber: current.jo_number,
    action: 'JOB_ORDER_CLOSED',
    performedBy: user.id,
    notes: closureNotes?.trim() || 'Ticket final-accepted and closed by management.',
    previousState: { status: current.status },
    resultingState: { status: 'CLOSED' },
  })

  return { success: true }
}
