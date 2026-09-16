/**
 * dispatcher.ts — Structured JSON activity logging to the activity_logs table.
 * Plan.md §2.3 / §10 (guardrail: all status changes must be logged).
 *
 * Call logActivity() from Server Actions or Route Handlers — NOT from Client
 * Components. Uses the server Supabase client so RLS is enforced.
 */

import { createClient } from '@/lib/supabase/server'
import type { TablesInsert } from '@/types/index'

export type LogActivityInput = Omit<
  TablesInsert<'activity_logs'>,
  'id' | 'timestamp'
>

/**
 * Appends a structured audit record to activity_logs.
 *
 * @param payload - All fields required by the activity_logs table (see Plan.md §3.2).
 * @returns The inserted row's id, or null if insert failed.
 */
export async function logActivity(payload: LogActivityInput): Promise<number | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('activity_logs')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    // Structured error output for observability — never swallow silently.
    console.error(JSON.stringify({
      level: 'error',
      source: 'dispatcher',
      message: 'Failed to write activity log',
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
      action: payload.action,
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
    }))
    return null
  }

  return data?.id ?? null
}

/**
 * Convenience wrapper for Job Order events.
 */
export async function logJOActivity(params: {
  joId: number
  joNumber: string
  action: string
  performedBy: string
  notes?: string
}): Promise<number | null> {
  return logActivity({
    entity_type: 'job_order',
    entity_id: params.joId,
    action: params.action,
    jo_id: params.joId,
    mrs_id: null,
    transmittal_id: null,
    reference_code: params.joNumber,
    details_notes: params.notes ?? null,
    performed_by: params.performedBy,
  })
}

/**
 * Convenience wrapper for Material Requisition events.
 */
export async function logMRSActivity(params: {
  mrsId: number
  mrsNumber: string
  action: string
  performedBy: string
  joId?: number | null
  notes?: string
}): Promise<number | null> {
  return logActivity({
    entity_type: 'material_requisition',
    entity_id: params.mrsId,
    action: params.action,
    jo_id: params.joId ?? null,
    mrs_id: params.mrsId,
    transmittal_id: null,
    reference_code: params.mrsNumber,
    details_notes: params.notes ?? null,
    performed_by: params.performedBy,
  })
}

/**
 * Convenience wrapper for Transmittal Form events.
 */
export async function logTransmittalActivity(params: {
  transmittalId: number
  transmittalNumber: string
  action: string
  performedBy: string
  mrsId?: number | null
  notes?: string
}): Promise<number | null> {
  return logActivity({
    entity_type: 'transmittal_form',
    entity_id: params.transmittalId,
    action: params.action,
    jo_id: null,
    mrs_id: params.mrsId ?? null,
    transmittal_id: params.transmittalId,
    reference_code: params.transmittalNumber,
    details_notes: params.notes ?? null,
    performed_by: params.performedBy,
  })
}
