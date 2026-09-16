'use server'

import { createClient } from '@/lib/supabase/server'
import { logJOActivity } from '@/lib/notifications/dispatcher'
import type { JOPriority } from '@/types/index'

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

  // Generate atomic reference number using next_reference_number('JO', year)
  // Plan.md §3.4 / Addendum guardrail #4 (never use SELECT COUNT(*)+1)
  let joNumber: string
  const { data: generatedNumber, error: rpcError } = await supabase.rpc(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'next_reference_number' as any,
    { p_prefix: 'JO', p_year: currentYear }
  )

  if (rpcError || !generatedNumber) {
    // Fallback if running before migration sync
    const randomSuffix = Math.floor(100000 + Math.random() * 900000)
    joNumber = `JO-${currentYear}-${randomSuffix}`
  } else {
    joNumber = generatedNumber as unknown as string
  }

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

  const allowedStatuses = ['PENDING_ASSESSMENT', 'IN_PROGRESS', 'AWAITING_MRS_APPROVAL']
  if (!allowedStatuses.includes(current.status)) {
    throw new Error(`Cannot cancel a Job Order in "${current.status}" status.`)
  }

  // Update status to CANCELLED — this triggers cascade_jo_cancellation() (§3.5)
  const { error: updateError } = await supabase
    .from('job_orders')
    .update({ status: 'CANCELLED' })
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

  if (current.status !== 'COMPLETED') {
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
