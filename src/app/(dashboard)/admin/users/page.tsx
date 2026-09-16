'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Users,
  UserPlus,
  Shield,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  Edit2,
  UserX,
  UserCheck,
  KeyRound,
  Building,
  Mail,
  Calendar,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  resetUserPassword,
  type CreateUserInput,
} from '@/lib/actions/user-actions'
import type { UserRole, AccountStatus } from '@/types/index'

interface UserRecord {
  id: string
  email: string
  full_name: string
  role: UserRole
  department_id: number
  account_status: AccountStatus
  created_at: string | null
  last_login_at: string | null
  deactivated_at: string | null
  department?: { id: number; department_name: string } | null
}

interface DepartmentRecord {
  id: number
  department_name: string
}

const ALL_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'MANAGER',
  'BUDGET_OFFICER',
  'ACCOUNTING',
  'PURCHASER',
  'MAINTENANCE',
  'FRONT_DESK',
  'STAFF',
  'STOREKEEPER',
]

const MANAGER_ALLOWED_ROLES: UserRole[] = [
  'MAINTENANCE',
  'FRONT_DESK',
  'STAFF',
  'PURCHASER',
]

const ROLE_COLORS: Record<UserRole, string> = {
  SUPER_ADMIN: 'bg-purple-900/40 text-purple-300 border-purple-800/60',
  MANAGER: 'bg-indigo-900/40 text-indigo-300 border-indigo-800/60',
  BUDGET_OFFICER: 'bg-amber-900/40 text-amber-300 border-amber-800/60',
  ACCOUNTING: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/60',
  PURCHASER: 'bg-cyan-900/40 text-cyan-300 border-cyan-800/60',
  MAINTENANCE: 'bg-blue-900/40 text-blue-300 border-blue-800/60',
  FRONT_DESK: 'bg-pink-900/40 text-pink-300 border-pink-800/60',
  STAFF: 'bg-slate-800 text-slate-300 border-slate-700',
  STOREKEEPER: 'bg-orange-900/40 text-orange-300 border-orange-800/60',
}

export default function UserManagementPage() {
  const supabase = createClient()

  // State
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null)
  const [users, setUsers] = useState<UserRecord[]>([])
  const [departments, setDepartments] = useState<DepartmentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [deptFilter, setDeptFilter] = useState<string>('ALL')

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editTarget, setEditTarget] = useState<UserRecord | null>(null)

  // Create Form State
  const [newEmail, setNewEmail] = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('STAFF')
  const [newDeptId, setNewDeptId] = useState<number>(1)
  const [newTempPassword, setNewTempPassword] = useState('FixFlowPass2026!')

  // Edit Form State
  const [editFullName, setEditFullName] = useState('')
  const [editRole, setEditRole] = useState<UserRole>('STAFF')
  const [editDeptId, setEditDeptId] = useState<number>(1)

  const isManager = currentRole === 'MANAGER'
  const isSuperAdmin = currentRole === 'SUPER_ADMIN'
  const availableRoles = isManager ? MANAGER_ALLOWED_ROLES : ALL_ROLES

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: currentUserRec } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single()

      if (currentUserRec) {
        setCurrentRole(currentUserRec.role as UserRole)
      }

      // Fetch all departments
      const { data: depts } = await supabase
        .from('departments')
        .select('id, department_name')
        .order('id')

      if (depts) setDepartments(depts)

      // Fetch users
      const { data: userList } = await supabase
        .from('users')
        .select('*, department:departments(id, department_name)')
        .order('full_name')

      if (userList) {
        setUsers(userList as unknown as UserRecord[])
      }
    } catch (err: unknown) {
      console.error('Failed to load users:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Handle Create User
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setFeedback(null)

    try {
      const payload: CreateUserInput = {
        email: newEmail,
        fullName: newFullName,
        role: newRole,
        departmentId: Number(newDeptId),
        temporaryPassword: newTempPassword,
      }

      const res = await createUser(payload)
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `User ${newFullName} (${newEmail}) successfully created with temporary password.`,
        })
        setShowCreateModal(false)
        setNewEmail('')
        setNewFullName('')
        setNewTempPassword('FixFlowPass2026!')
        await loadData()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create user.'
      setFeedback({ type: 'error', message: msg })
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Edit User
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editTarget) return

    setSubmitting(true)
    setFeedback(null)

    try {
      const res = await updateUser({
        userId: editTarget.id,
        fullName: editFullName,
        role: editRole,
        departmentId: Number(editDeptId),
      })

      if (res.success) {
        setFeedback({
          type: 'success',
          message: `User profile for ${editFullName} updated.`,
        })
        setEditTarget(null)
        await loadData()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update user.'
      setFeedback({ type: 'error', message: msg })
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Soft Deactivate
  const handleDeactivate = async (u: UserRecord) => {
    if (!confirm(`Are you sure you want to soft-deactivate ${u.full_name}? Historical signatures and audit records will remain preserved.`)) {
      return
    }

    setFeedback(null)
    try {
      const res = await deactivateUser(u.id)
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `User ${u.full_name} deactivated. Historical signatures preserved.`,
        })
        await loadData()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to deactivate user.'
      setFeedback({ type: 'error', message: msg })
    }
  }

  // Handle Reactivate
  const handleReactivate = async (u: UserRecord) => {
    setFeedback(null)
    try {
      const res = await reactivateUser(u.id)
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `User ${u.full_name} reactivated to ACTIVE status.`,
        })
        await loadData()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reactivate user.'
      setFeedback({ type: 'error', message: msg })
    }
  }

  // Handle Reset Password Flag
  const handleResetPassword = async (u: UserRecord) => {
    if (!confirm(`Flag ${u.full_name} for mandatory password reset on next login?`)) {
      return
    }

    setFeedback(null)
    try {
      const res = await resetUserPassword(u.id)
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Password reset flagged for ${u.full_name}. Account status is PASSWORD_RESET_REQUIRED.`,
        })
        await loadData()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reset password.'
      setFeedback({ type: 'error', message: msg })
    }
  }

  // Filtered Users
  const filteredUsers = users.filter(u => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const matchesName = u.full_name.toLowerCase().includes(query)
      const matchesEmail = u.email.toLowerCase().includes(query)
      if (!matchesName && !matchesEmail) return false
    }

    if (roleFilter !== 'ALL' && u.role !== roleFilter) return false
    if (statusFilter !== 'ALL' && u.account_status !== statusFilter) return false
    if (deptFilter !== 'ALL' && u.department_id !== Number(deptFilter)) return false

    return true
  })

  // Permission Gate
  if (!loading && !isSuperAdmin && !isManager) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center space-y-4">
        <div className="w-16 h-16 bg-red-900/30 text-red-400 rounded-full flex items-center justify-center mx-auto border border-red-800/50">
          <Shield className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-white">Access Restricted</h2>
        <p className="text-sm text-slate-400">
          Form 18 (User Management) is restricted to Super Administrators and Department Managers.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-900/30 border border-indigo-700/40 rounded-lg text-indigo-400">
              <Users className="w-5 h-5" />
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-white">User Management</h1>
          </div>
          <p className="text-xs md:text-sm text-slate-400 mt-1">
            Form 18 — Staff onboarding, role governance, and audit-safe deactivation.
            {isManager && (
              <span className="ml-2 text-amber-400 font-semibold">
                (Manager View: Role-locked to operational staff)
              </span>
            )}
          </p>
        </div>

        <button
          onClick={() => {
            setFeedback(null)
            setShowCreateModal(true)
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-all shadow-md shadow-indigo-950/40 shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          Create New User
        </button>
      </div>

      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`p-4 rounded-lg flex items-start gap-3 border text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
              : 'bg-red-950/40 border-red-800/60 text-red-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">{feedback.message}</div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-800/70 border border-slate-700/60 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="px-3 py-2 bg-slate-800/70 border border-slate-700/60 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
        >
          <option value="ALL">All Roles ({users.length})</option>
          {ALL_ROLES.map(r => (
            <option key={r} value={r}>
              {r.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <select
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          className="px-3 py-2 bg-slate-800/70 border border-slate-700/60 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
        >
          <option value="ALL">All Departments</option>
          {departments.map(d => (
            <option key={d.id} value={d.id}>
              {d.department_name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-slate-800/70 border border-slate-700/60 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
        >
          <option value="ALL">All Account Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PASSWORD_RESET_REQUIRED">Password Reset Required</option>
          <option value="INACTIVE">Deactivated (Soft)</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            <p className="text-sm">Loading users directory...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            No user accounts found matching the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs md:text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-semibold text-xs">
                  <th className="py-3.5 px-4">User</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Department</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Joined / Last Active</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredUsers.map(u => {
                  const isDeactivated = u.account_status === 'INACTIVE'
                  const isProtected =
                    u.role === 'SUPER_ADMIN' ||
                    u.role === 'BUDGET_OFFICER' ||
                    u.role === 'ACCOUNTING' ||
                    u.role === 'STOREKEEPER'

                  const canManage = isSuperAdmin || (!isProtected && isManager)

                  return (
                    <tr
                      key={u.id}
                      className={`hover:bg-slate-800/30 transition-colors ${
                        isDeactivated ? 'opacity-60 bg-slate-950/40' : ''
                      }`}
                    >
                      {/* Name & Email */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-100">{u.full_name}</div>
                        <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                          <Mail className="w-3 h-3 text-slate-500" />
                          <span>{u.email}</span>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded border ${
                            ROLE_COLORS[u.role] || 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {u.role.replace(/_/g, ' ')}
                        </span>
                      </td>

                      {/* Department */}
                      <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Building className="w-3.5 h-3.5 text-slate-500" />
                          <span>{u.department?.department_name || `Dept #${u.department_id}`}</span>
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {u.account_status === 'ACTIVE' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 rounded">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Active
                          </span>
                        )}
                        {u.account_status === 'PASSWORD_RESET_REQUIRED' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-950/40 border border-amber-800/50 px-2 py-0.5 rounded">
                            Reset Required
                          </span>
                        )}
                        {u.account_status === 'INACTIVE' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400 bg-red-950/40 border border-red-800/50 px-2 py-0.5 rounded">
                            Deactivated
                          </span>
                        )}
                      </td>

                      {/* Created / Active Dates */}
                      <td className="py-3 px-4 text-xs text-slate-500 whitespace-nowrap">
                        <div>
                          {u.created_at
                            ? new Date(u.created_at).toLocaleDateString('en-PH', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })
                            : '—'}
                        </div>
                        {u.deactivated_at && (
                          <div className="text-red-400/80 text-[10px] mt-0.5">
                            Deactivated: {new Date(u.deactivated_at).toLocaleDateString()}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {canManage ? (
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Edit Profile */}
                            <button
                              onClick={() => {
                                setEditTarget(u)
                                setEditFullName(u.full_name)
                                setEditRole(u.role)
                                setEditDeptId(u.department_id)
                              }}
                              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                              title="Edit Profile"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>

                            {/* Reset Password */}
                            <button
                              onClick={() => handleResetPassword(u)}
                              className="p-1.5 rounded hover:bg-amber-950/40 text-amber-500/80 hover:text-amber-400 transition-colors"
                              title="Flag Password Reset"
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>

                            {/* Deactivate / Reactivate */}
                            {isDeactivated ? (
                              <button
                                onClick={() => handleReactivate(u)}
                                className="p-1.5 rounded hover:bg-emerald-950/40 text-emerald-500/80 hover:text-emerald-400 transition-colors"
                                title="Reactivate Account"
                              >
                                <UserCheck className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleDeactivate(u)}
                                className="p-1.5 rounded hover:bg-red-950/40 text-red-400/80 hover:text-red-300 transition-colors"
                                title="Soft Deactivate (Preserves historical signatures)"
                              >
                                <UserX className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-600 italic">
                            Protected
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CREATE USER MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-6 relative">
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-5">
              <div className="p-2 bg-indigo-900/30 border border-indigo-700/40 rounded-lg text-indigo-400">
                <UserPlus className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-white">Create New User</h3>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Maria Santos"
                  value={newFullName}
                  onChange={e => setNewFullName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="maria.santos@company.ph"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Role</label>
                  <select
                    value={newRole}
                    onChange={e => setNewRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
                  >
                    {availableRoles.map(r => (
                      <option key={r} value={r}>
                        {r.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Department</label>
                  <select
                    value={newDeptId}
                    onChange={e => setNewDeptId(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
                  >
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.department_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Initial Temporary Password
                </label>
                <input
                  type="text"
                  required
                  value={newTempPassword}
                  onChange={e => setNewTempPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-mono text-xs focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Status defaults to PASSWORD_RESET_REQUIRED. User must reset upon first login.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold transition-colors flex items-center gap-2"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT USER MODAL */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-6 relative">
            <button
              onClick={() => setEditTarget(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-5">
              <div className="p-2 bg-blue-900/30 border border-blue-700/40 rounded-lg text-blue-400">
                <Edit2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Edit Profile</h3>
                <p className="text-xs text-slate-400">{editTarget.email}</p>
              </div>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={e => setEditFullName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Role</label>
                  <select
                    value={editRole}
                    onChange={e => setEditRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
                  >
                    {availableRoles.map(r => (
                      <option key={r} value={r}>
                        {r.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Department</label>
                  <select
                    value={editDeptId}
                    onChange={e => setEditDeptId(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
                  >
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.department_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold transition-colors flex items-center gap-2"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
