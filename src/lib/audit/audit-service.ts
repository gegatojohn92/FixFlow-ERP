'use server'

import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/types/index'
import {
  type AuditEventInput,
  type AuditEventRow,
  type AuditJsonValue,
  type AuditLogFilters,
  type AuditMetadata,
  isAuditAction,
  isAuditEntityType,
} from './audit-types'

const SENSITIVE_KEYS = new Set([
  'access_token',
  'auth_token',
  'password',
  'temporary_password',
  'service_role_key',
  'secret',
  'authorization',
  'raw_request_body',
])
const MAX_METADATA_LENGTH = 12000

async function requireActiveAuditUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Authentication required for audit access.')

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('account_status')
    .eq('id', user.id)
    .single()
  if (profileError || profile?.account_status !== 'ACTIVE') {
    throw new Error('An active user profile is required for audit access.')
  }
  return user
}

function sanitizeValue(value: AuditJsonValue, depth = 0): AuditJsonValue {
  if (depth > 4) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeValue(item, depth + 1))
  if (value === null || typeof value !== 'object') return value

  const output: Record<string, AuditJsonValue> = {}
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue
    if (child === undefined) continue
    output[key] = sanitizeValue(child, depth + 1)
  }
  return output
}

function sanitizeMetadata(metadata: AuditMetadata | undefined): AuditMetadata {
  if (!metadata) return {}
  const sanitized = sanitizeValue(metadata) as AuditMetadata
  const serialized = JSON.stringify(sanitized)
  if (serialized.length <= MAX_METADATA_LENGTH) return sanitized
  return { truncated: true, summary: serialized.slice(0, MAX_METADATA_LENGTH - 32) }
}

function assertTaxonomy(input: AuditEventInput) {
  if (!isAuditEntityType(input.entityType)) throw new Error('Invalid audit entity type.')
  if (!isAuditAction(input.action)) throw new Error('Invalid audit action.')
  if (!Number.isInteger(input.entityId) || input.entityId < 0) throw new Error('Invalid audit entity id.')
}

export async function recordAuditEvent(input: AuditEventInput): Promise<number> {
  assertTaxonomy(input)
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Authentication required for audit logging.')

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('full_name, role, department_id, account_status')
    .eq('id', user.id)
    .single()

  if (profileError || !profile || profile.account_status !== 'ACTIVE') {
    throw new Error('An active user profile is required for audit logging.')
  }

  const { data: department } = await supabase
    .from('departments')
    .select('department_name')
    .eq('id', profile.department_id)
    .single()

  const entityDepartmentId = input.entityDepartmentId ?? await resolveEntityDepartmentId(supabase, input)

  const payload = {
    actor_user_id: user.id,
    actor_name: profile.full_name,
    actor_role: profile.role,
    actor_department_id: profile.department_id,
    actor_department_name: department?.department_name ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId,
    entity_department_id: entityDepartmentId,
    reference_code: input.referenceCode ?? null,
    action: input.action,
    previous_state: input.previousState === undefined ? null : sanitizeValue(input.previousState),
    resulting_state: input.resultingState === undefined ? null : sanitizeValue(input.resultingState),
    metadata: sanitizeMetadata(input.metadata),
    correlation_id: input.correlationId ?? null,
    idempotency_key: input.idempotencyKey ?? null,
  }

  const { data, error } = await supabase
    .from('audit_events')
    .insert(payload as never)
    .select('id')
    .single()

  if (!error && data) return data.id

  if (error?.code === '23505' && input.idempotencyKey) {
    const { data: existing } = await supabase
      .from('audit_events')
      .select('id')
      .eq('idempotency_key', input.idempotencyKey)
      .single()
    if (existing) return existing.id
  }

  throw new Error(error?.message || 'Failed to persist audit event.')
}

async function resolveEntityDepartmentId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: AuditEventInput
): Promise<number | null> {
  if (input.entityType === 'material_requisition') {
    const { data } = await supabase
      .from('material_requisitions')
      .select('department_id')
      .eq('id', input.entityId)
      .maybeSingle()
    return data?.department_id ?? null
  }

  if (input.entityType === 'job_order') {
    const { data } = await supabase
      .from('job_orders')
      .select('requester_id')
      .eq('id', input.entityId)
      .maybeSingle()
    if (!data?.requester_id) return null
    const { data: requester } = await supabase
      .from('users')
      .select('department_id')
      .eq('id', data.requester_id)
      .maybeSingle()
    return requester?.department_id ?? null
  }

  if (input.entityType === 'mrs_line_item') {
    const { data } = await supabase
      .from('mrs_line_items')
      .select('mrs_id')
      .eq('id', input.entityId)
      .maybeSingle()
    if (!data?.mrs_id) return null
    const { data: mrs } = await supabase
      .from('material_requisitions')
      .select('department_id')
      .eq('id', data.mrs_id)
      .maybeSingle()
    return mrs?.department_id ?? null
  }

  if (input.entityType === 'transmittal_form') {
    const { data } = await supabase
      .from('transmittal_forms')
      .select('mrs_id')
      .eq('id', input.entityId)
      .maybeSingle()
    if (!data?.mrs_id) return null
    const { data: mrs } = await supabase
      .from('material_requisitions')
      .select('department_id')
      .eq('id', data.mrs_id)
      .maybeSingle()
    return mrs?.department_id ?? null
  }

  return null
}

function mapAuditRow(row: Tables<'audit_events'>): AuditEventRow {
  if (!isAuditEntityType(row.entity_type) || !isAuditAction(row.action)) {
    throw new Error('Database contains an unknown audit taxonomy value.')
  }
  return { ...row, entity_type: row.entity_type, action: row.action, metadata: row.metadata as AuditMetadata }
}

export async function listAuditEvents(filters: AuditLogFilters = {}) {
  const supabase = await createClient()
  await requireActiveAuditUser(supabase)
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100)
  const page = Math.max(filters.page ?? 1, 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('audit_events')
    .select('*', { count: 'exact' })
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to)

  if (filters.entityType) query = query.eq('entity_type', filters.entityType)
  if (filters.action) query = query.eq('action', filters.action)
  if (filters.actorUserId) query = query.eq('actor_user_id', filters.actorUserId)
  if (filters.departmentId) query = query.or(`actor_department_id.eq.${filters.departmentId},entity_department_id.eq.${filters.departmentId}`)
  if (filters.referenceCode) query = query.ilike('reference_code', `%${filters.referenceCode}%`)
  if (filters.from) query = query.gte('occurred_at', filters.from)
  if (filters.to) query = query.lte('occurred_at', filters.to)

  const { data, count, error } = await query
  if (error) throw new Error(error.message)

  return {
    events: (data ?? []).map(row => mapAuditRow(row)),
    total: count ?? 0,
    page,
    pageSize,
  }
}

export async function getAuditHistory(entityType: AuditEventInput['entityType'], entityId: number) {
  const supabase = await createClient()
  await requireActiveAuditUser(supabase)
  const { data, error } = await supabase
    .from('audit_events')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('occurred_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []).map(row => mapAuditRow(row))
}

export type { AuditEventInput, AuditEventRow, AuditLogFilters }
