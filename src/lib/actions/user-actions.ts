'use server'

import { createClient, getServerUser } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logActivity } from '@/lib/notifications/dispatcher'
import type { Database } from '@/types/database.types'
import type { UserRole } from '@/types/index'

// Roles that Managers are strictly forbidden from assigning (Plan.md §2 & Form 18)
const MANAGER_BLOCKED_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'BUDGET_OFFICER',
  'ACCOUNTING',
  'STOREKEEPER',
]

export interface CreateUserInput {
  email: string
  fullName: string
  role: UserRole
  departmentId: number
  temporaryPassword?: string
}

export interface UpdateUserInput {
  userId: string
  fullName: string
  role: UserRole
  departmentId: number
}

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (url && serviceKey && !serviceKey.includes('your-service-role-key')) {
    return createAdminClient<Database>(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }
  return null
}

/**
 * Form 18 — Create User (Plan.md §5 Form 18)
 * Super Admin (all roles), Manager (operational staff only).
 */
export async function createUser(input: CreateUserInput) {
  const supabase = await createClient()
  const currentUser = await getServerUser()
  if (!currentUser) throw new Error('Session expired or invalid. Please sign in again.')

  // Fetch creator's role
  const { data: creator } = await supabase
    .from('users')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  if (!creator || (creator.role !== 'SUPER_ADMIN' && creator.role !== 'MANAGER')) {
    throw new Error('Unauthorized: Only Super Admins and Managers can create users.')
  }

  // Role-lock check for Managers
  if (creator.role === 'MANAGER' && MANAGER_BLOCKED_ROLES.includes(input.role)) {
    throw new Error(
      `Access Denied: Managers cannot create accounts with the ${input.role} role.`
    )
  }

  const adminClient = getServiceRoleClient()
  let authUserId = crypto.randomUUID()
  const tempPassword = input.temporaryPassword || 'FixFlowPass2026!'

  if (adminClient) {
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email: input.email.trim(),
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: input.fullName.trim(),
        role: input.role,
        department_id: input.departmentId,
      },
    })

    if (authError) {
      throw new Error(`Failed to create auth account: ${authError.message}`)
    }
    if (authUser.user) {
      authUserId = authUser.user.id
    }
  }

  // Insert into public.users table
  const { data: newUser, error: insertError } = await supabase
    .from('users')
    .insert({
      id: authUserId,
      email: input.email.trim().toLowerCase(),
      full_name: input.fullName.trim(),
      role: input.role,
      department_id: input.departmentId,
      account_status: 'PASSWORD_RESET_REQUIRED',
      created_by: currentUser.id,
    })
    .select()
    .single()

  if (insertError) {
    // If auth user was created with service role, roll back auth user
    if (adminClient) {
      await adminClient.auth.admin.deleteUser(authUserId).catch(() => {})
    }
    throw new Error(`Failed to create database user: ${insertError.message}`)
  }

  // Structured Audit Log
  await logActivity({
    entity_type: 'user',
    entity_id: 0,
    action: 'USER_CREATED',
    jo_id: null,
    mrs_id: null,
    transmittal_id: null,
    reference_code: newUser.email,
    details_notes: `Created user ${newUser.full_name} (${newUser.email}) with role ${newUser.role}. Default status: PASSWORD_RESET_REQUIRED.`,
    performed_by: currentUser.id,
  })

  return { success: true, user: newUser }
}

/**
 * Form 18 — Edit Profile (Plan.md §5 Form 18)
 */
export async function updateUser(input: UpdateUserInput) {
  const supabase = await createClient()
  const currentUser = await getServerUser()
  if (!currentUser) throw new Error('Session expired or invalid. Please sign in again.')

  const { data: modifier } = await supabase
    .from('users')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  if (!modifier || (modifier.role !== 'SUPER_ADMIN' && modifier.role !== 'MANAGER')) {
    throw new Error('Unauthorized.')
  }

  // Role-lock check for Managers
  if (modifier.role === 'MANAGER' && MANAGER_BLOCKED_ROLES.includes(input.role)) {
    throw new Error(
      `Access Denied: Managers cannot assign the ${input.role} role.`
    )
  }

  // Also check if the target user has a protected role
  const { data: targetUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', input.userId)
    .single()

  if (
    modifier.role === 'MANAGER' &&
    targetUser &&
    MANAGER_BLOCKED_ROLES.includes(targetUser.role as UserRole)
  ) {
    throw new Error('Access Denied: Managers cannot modify protected executive accounts.')
  }

  const { error } = await supabase
    .from('users')
    .update({
      full_name: input.fullName.trim(),
      role: input.role,
      department_id: input.departmentId,
    })
    .eq('id', input.userId)

  if (error) throw new Error(error.message)

  // Update auth metadata if service role key available
  const adminClient = getServiceRoleClient()
  if (adminClient) {
    await adminClient.auth.admin
      .updateUserById(input.userId, {
        user_metadata: {
          full_name: input.fullName.trim(),
          role: input.role,
          department_id: input.departmentId,
        },
      })
      .catch(() => {})
  }

  await logActivity({
    entity_type: 'user',
    entity_id: 0,
    action: 'USER_UPDATED',
    jo_id: null,
    mrs_id: null,
    transmittal_id: null,
    reference_code: input.userId,
    details_notes: `Updated user profile to ${input.fullName}, role: ${input.role}, dept: ${input.departmentId}.`,
    performed_by: currentUser.id,
  })

  return { success: true }
}

/**
 * Form 18 — Soft Deactivate User (Plan.md §1 & §5 Form 18)
 * Sets account_status = 'INACTIVE' and deactivated_at = NOW().
 * Preserves historical signatures and all audit records.
 */
export async function deactivateUser(userId: string) {
  const supabase = await createClient()
  const currentUser = await getServerUser()
  if (!currentUser) throw new Error('Session expired or invalid. Please sign in again.')

  if (currentUser.id === userId) {
    throw new Error('Cannot deactivate your own active account.')
  }

  const { data: modifier } = await supabase
    .from('users')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  if (!modifier || (modifier.role !== 'SUPER_ADMIN' && modifier.role !== 'MANAGER')) {
    throw new Error('Unauthorized.')
  }

  const { data: targetUser } = await supabase
    .from('users')
    .select('role, full_name, email')
    .eq('id', userId)
    .single()

  if (
    modifier.role === 'MANAGER' &&
    targetUser &&
    MANAGER_BLOCKED_ROLES.includes(targetUser.role as UserRole)
  ) {
    throw new Error('Access Denied: Managers cannot deactivate protected executive accounts.')
  }

  const { error } = await supabase
    .from('users')
    .update({
      account_status: 'INACTIVE',
      deactivated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) throw new Error(error.message)

  await logActivity({
    entity_type: 'user',
    entity_id: 0,
    action: 'USER_DEACTIVATED',
    jo_id: null,
    mrs_id: null,
    transmittal_id: null,
    reference_code: targetUser?.email || userId,
    details_notes: `User ${targetUser?.full_name || userId} soft-deactivated. Historical signatures preserved.`,
    performed_by: currentUser.id,
  })

  return { success: true }
}

/**
 * Form 18 — Reactivate User
 */
export async function reactivateUser(userId: string) {
  const supabase = await createClient()
  const currentUser = await getServerUser()
  if (!currentUser) throw new Error('Session expired or invalid. Please sign in again.')

  const { data: modifier } = await supabase
    .from('users')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  if (!modifier || (modifier.role !== 'SUPER_ADMIN' && modifier.role !== 'MANAGER')) {
    throw new Error('Unauthorized.')
  }

  const { error } = await supabase
    .from('users')
    .update({
      account_status: 'ACTIVE',
      deactivated_at: null,
    })
    .eq('id', userId)

  if (error) throw new Error(error.message)

  await logActivity({
    entity_type: 'user',
    entity_id: 0,
    action: 'USER_REACTIVATED',
    jo_id: null,
    mrs_id: null,
    transmittal_id: null,
    reference_code: userId,
    details_notes: `User ${userId} reactivated to ACTIVE status.`,
    performed_by: currentUser.id,
  })

  return { success: true }
}

/**
 * Form 18 — Reset Password Flag / Temporary Password
 */
export async function resetUserPassword(userId: string, newPassword?: string) {
  const supabase = await createClient()
  const currentUser = await getServerUser()
  if (!currentUser) throw new Error('Session expired or invalid. Please sign in again.')

  const { data: modifier } = await supabase
    .from('users')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  if (!modifier || (modifier.role !== 'SUPER_ADMIN' && modifier.role !== 'MANAGER')) {
    throw new Error('Unauthorized.')
  }

  const { error } = await supabase
    .from('users')
    .update({
      account_status: 'PASSWORD_RESET_REQUIRED',
    })
    .eq('id', userId)

  if (error) throw new Error(error.message)

  const adminClient = getServiceRoleClient()
  if (adminClient && newPassword) {
    await adminClient.auth.admin.updateUserById(userId, {
      password: newPassword,
    })
  }

  await logActivity({
    entity_type: 'user',
    entity_id: 0,
    action: 'USER_PASSWORD_RESET_REQUESTED',
    jo_id: null,
    mrs_id: null,
    transmittal_id: null,
    reference_code: userId,
    details_notes: `Password reset flagged for user ${userId}. Status: PASSWORD_RESET_REQUIRED.`,
    performed_by: currentUser.id,
  })

  return { success: true }
}
