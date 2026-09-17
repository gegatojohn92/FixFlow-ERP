import type { UserRole } from '@/types/index'

export const USER_ROLES: UserRole[] = [
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

export type RouteAccessRule = {
  prefix: string
  roles: readonly UserRole[]
  label?: string
}

export const ROUTE_ACCESS_RULES: readonly RouteAccessRule[] = [
  { prefix: '/jo', roles: ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE', 'STAFF', 'FRONT_DESK', 'BUDGET_OFFICER', 'ACCOUNTING', 'PURCHASER', 'STOREKEEPER'], label: 'Job Orders' },
  { prefix: '/mrs/stock-check', roles: ['SUPER_ADMIN', 'STOREKEEPER'], label: 'MRS Stock Check' },
  { prefix: '/mrs/manager-queue', roles: ['SUPER_ADMIN', 'MANAGER'], label: 'MRS Manager Queue' },
  { prefix: '/mrs/canvass', roles: ['SUPER_ADMIN', 'BUDGET_OFFICER'], label: 'MRS Canvass' },
  { prefix: '/mrs', roles: ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE', 'STAFF', 'FRONT_DESK', 'BUDGET_OFFICER', 'ACCOUNTING', 'PURCHASER', 'STOREKEEPER'], label: 'Material Requisitions' },
  { prefix: '/transmittals/accounting', roles: ['SUPER_ADMIN', 'ACCOUNTING'], label: 'Accounting Transmittals' },
  { prefix: '/transmittals/front-desk', roles: ['SUPER_ADMIN', 'FRONT_DESK', 'BUDGET_OFFICER'], label: 'Front Desk Transmittals' },
  { prefix: '/transmittals', roles: ['SUPER_ADMIN', 'ACCOUNTING', 'BUDGET_OFFICER', 'FRONT_DESK', 'PURCHASER', 'MANAGER'], label: 'Transmittals' },
  { prefix: '/purchaser', roles: ['SUPER_ADMIN', 'PURCHASER'], label: 'Purchaser Queue' },
  { prefix: '/delivery', roles: ['SUPER_ADMIN', 'PURCHASER', 'FRONT_DESK', 'MAINTENANCE', 'STOREKEEPER'], label: 'Delivery Verification' },
  { prefix: '/pms', roles: ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE'], label: 'PMS' },
  { prefix: '/reports', roles: ['SUPER_ADMIN', 'MANAGER', 'ACCOUNTING', 'BUDGET_OFFICER'], label: 'Reports' },
  { prefix: '/audit-logs', roles: ['SUPER_ADMIN', 'MANAGER', 'BUDGET_OFFICER', 'ACCOUNTING', 'PURCHASER', 'MAINTENANCE', 'FRONT_DESK', 'STAFF', 'STOREKEEPER'], label: 'Audit Logs' },
  { prefix: '/admin', roles: ['SUPER_ADMIN', 'MANAGER'], label: 'Admin & Users' },
  { prefix: '/dashboard', roles: ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE', 'STAFF', 'FRONT_DESK', 'BUDGET_OFFICER', 'ACCOUNTING', 'PURCHASER', 'STOREKEEPER'], label: 'Dashboard' },
] as const

export const NAVIGATION_GROUPS = {
  workflow: ['/', '/dashboard', '/jo/new', '/jo/track', '/jo/queue', '/mrs', '/purchaser', '/delivery', '/transmittals', '/pms', '/audit-logs'],
  admin: ['/admin/users'],
  reports: ['/reports/expense'],
} as const

export function isSuperAdmin(role: UserRole) {
  return role === 'SUPER_ADMIN'
}

export function canViewRoute(role: UserRole, pathname: string): boolean {
  if (isSuperAdmin(role)) {
    return true
  }

  const matchingRule = [...ROUTE_ACCESS_RULES]
    .filter(rule => pathname.startsWith(rule.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]

  if (!matchingRule) {
    return false
  }

  return matchingRule.roles.includes(role)
}

export function hasRouteAccess(role: UserRole, pathname: string): boolean {
  return canViewRoute(role, pathname)
}

export function isNavigationVisible(role: UserRole, href: string): boolean {
  return canViewRoute(role, href)
}

export function getAccessibleRoutesForRole(role: UserRole): string[] {
  return ROUTE_ACCESS_RULES
    .filter(rule => isSuperAdmin(role) || rule.roles.includes(role))
    .map(rule => rule.prefix)
}

export function getNavigationGroupForRole(role: UserRole) {
  return {
    workflow: NAVIGATION_GROUPS.workflow.filter(path => canViewRoute(role, path)),
    admin: NAVIGATION_GROUPS.admin.filter(path => canViewRoute(role, path)),
    reports: NAVIGATION_GROUPS.reports.filter(path => canViewRoute(role, path)),
  }
}

export function canMutateWorkflow(role: UserRole, action: 'JO' | 'MRS' | 'TRANSMITTAL' | 'PMS' | 'USER_ADMIN') {
  const allowedByAction: Record<typeof action, UserRole[]> = {
    JO: ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE', 'STAFF', 'FRONT_DESK'],
    MRS: ['SUPER_ADMIN', 'MANAGER', 'BUDGET_OFFICER', 'ACCOUNTING', 'PURCHASER', 'STOREKEEPER', 'STAFF', 'FRONT_DESK'],
    TRANSMITTAL: ['SUPER_ADMIN', 'BUDGET_OFFICER', 'ACCOUNTING', 'FRONT_DESK', 'PURCHASER', 'MANAGER'],
    PMS: ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE'],
    USER_ADMIN: ['SUPER_ADMIN', 'MANAGER'],
  }

  if (role === 'SUPER_ADMIN') {
    return true
  }

  return allowedByAction[action].includes(role)
}
