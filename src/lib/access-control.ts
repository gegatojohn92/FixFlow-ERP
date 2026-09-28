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
  // STOREKEEPER was retired by migration 0020 (Form 6 removed) — see
  // RETIRED_ROLES in status-machines.ts. The enum value still exists in
  // PostgreSQL, so it is simply never offered or granted here.
]

export type RouteAccessRule = {
  prefix: string
  roles: readonly UserRole[]
  label?: string
}

export const ROUTE_ACCESS_RULES: readonly RouteAccessRule[] = [
  { prefix: '/jo', roles: ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE', 'STAFF', 'FRONT_DESK', 'BUDGET_OFFICER', 'ACCOUNTING', 'PURCHASER'], label: 'Job Orders' },
  { prefix: '/mrs/manager-queue', roles: ['SUPER_ADMIN', 'MANAGER'], label: 'MRS Manager Queue' },
  { prefix: '/mrs/canvass', roles: ['SUPER_ADMIN', 'BUDGET_OFFICER'], label: 'MRS Canvass' },
  { prefix: '/mrs', roles: ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE', 'STAFF', 'FRONT_DESK', 'BUDGET_OFFICER', 'ACCOUNTING', 'PURCHASER'], label: 'Material Requisitions' },
  { prefix: '/transmittals/accounting', roles: ['SUPER_ADMIN', 'ACCOUNTING'], label: 'Accounting Transmittals' },
  { prefix: '/transmittals/front-desk', roles: ['SUPER_ADMIN', 'FRONT_DESK', 'BUDGET_OFFICER'], label: 'Front Desk Transmittals' },
  { prefix: '/transmittals', roles: ['SUPER_ADMIN', 'ACCOUNTING', 'BUDGET_OFFICER', 'FRONT_DESK', 'PURCHASER', 'MANAGER'], label: 'Transmittals' },
  { prefix: '/purchaser', roles: ['SUPER_ADMIN', 'PURCHASER'], label: 'Purchaser Queue' },
  { prefix: '/delivery', roles: ['SUPER_ADMIN', 'PURCHASER', 'FRONT_DESK', 'MAINTENANCE'], label: 'Delivery Verification' },
  { prefix: '/pms', roles: ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE'], label: 'PMS' },
  { prefix: '/reports', roles: ['SUPER_ADMIN', 'MANAGER', 'ACCOUNTING', 'BUDGET_OFFICER'], label: 'Reports' },
  { prefix: '/audit-logs', roles: ['SUPER_ADMIN', 'MANAGER', 'BUDGET_OFFICER', 'ACCOUNTING', 'PURCHASER', 'MAINTENANCE', 'FRONT_DESK', 'STAFF'], label: 'Audit Logs' },
  { prefix: '/admin', roles: ['SUPER_ADMIN', 'MANAGER'], label: 'Admin & Users' },
  { prefix: '/dashboard', roles: ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE', 'STAFF', 'FRONT_DESK', 'BUDGET_OFFICER', 'ACCOUNTING', 'PURCHASER'], label: 'Dashboard' },
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
    MRS: ['SUPER_ADMIN', 'MANAGER', 'BUDGET_OFFICER', 'ACCOUNTING', 'PURCHASER', 'STAFF', 'FRONT_DESK'],
    TRANSMITTAL: ['SUPER_ADMIN', 'BUDGET_OFFICER', 'ACCOUNTING', 'FRONT_DESK', 'PURCHASER', 'MANAGER'],
    PMS: ['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE'],
    USER_ADMIN: ['SUPER_ADMIN', 'MANAGER'],
  }

  if (role === 'SUPER_ADMIN') {
    return true
  }

  return allowedByAction[action].includes(role)
}

// ──────────────────────────────────────────────────────────
// Navigation catalog & role-focused quick actions
// Single source of truth for the dashboard header, mobile
// bottom bar, "More" sheet, and role quick-access menus.
// ──────────────────────────────────────────────────────────

export interface NavItem {
  href: string
  label: string
  group: string
  /** Master form number from agent_handoff §5 (e.g. 'Form 8'). */
  formLabel?: string
}

export const NAV_CATALOG: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', group: 'Overview' },

  // Job Orders — Forms 1–4
  { href: '/jo/new', label: 'New JO', group: 'Job Orders', formLabel: 'Form 1' },
  { href: '/jo/track', label: 'Track JO', group: 'Job Orders', formLabel: 'Form 2' },
  { href: '/jo/queue', label: 'Tech Queue', group: 'Job Orders', formLabel: 'Form 3' },
  { href: '/jo/queue/escalated', label: 'Escalated Queue', group: 'Job Orders', formLabel: 'Form 4' },

  // Material Requisitions — Forms 5–9
  { href: '/mrs/new', label: 'New MRS', group: 'Requisitions (MRS)', formLabel: 'Form 5' },
  { href: '/mrs/manager-queue', label: 'Manager Queue', group: 'Requisitions (MRS)', formLabel: 'Form 7' },
  { href: '/mrs/canvass', label: 'Canvass & Owner Approval', group: 'Requisitions (MRS)', formLabel: 'Form 8' },
  { href: '/mrs', label: 'Requisitions Ledger', group: 'Requisitions (MRS)', formLabel: 'Form 9' },

  // Financial Transmittals — Forms 10–12
  { href: '/transmittals', label: 'Transmittals Hub', group: 'Finance & Transmittals' },
  { href: '/transmittals/create', label: 'Create Transmittal', group: 'Finance & Transmittals', formLabel: 'Form 10' },
  { href: '/transmittals/accounting', label: 'Accounting Disbursement', group: 'Finance & Transmittals', formLabel: 'Form 11' },
  { href: '/transmittals/front-desk', label: 'Front Desk Float & COD', group: 'Finance & Transmittals', formLabel: 'Form 12' },

  // Purchasing & Receiving — Forms 13–14
  { href: '/purchaser/queue', label: 'Purchaser Queue', group: 'Operations & Receiving', formLabel: 'Form 13' },
  { href: '/delivery/verify', label: 'Delivery Verification', group: 'Operations & Receiving', formLabel: 'Form 14' },

  // Preventive Maintenance — Forms 15–16
  { href: '/pms', label: 'PMS Hub', group: 'Preventive Maintenance' },
  { href: '/pms/daily', label: 'Daily PMS Queue', group: 'Preventive Maintenance', formLabel: 'Form 15' },
  { href: '/pms/aircon', label: 'Aircon 3-Month Service', group: 'Preventive Maintenance', formLabel: 'Form 16' },
  { href: '/pms/register', label: 'Register Asset', group: 'Preventive Maintenance' },

  // Analytics & Administration — Forms 17–18
  { href: '/reports/expense', label: 'Expense Analytics', group: 'Insights & Audit', formLabel: 'Form 17' },
  { href: '/audit-logs', label: 'Audit Logs', group: 'Insights & Audit' },
  { href: '/admin/users', label: 'User Management', group: 'Administration', formLabel: 'Form 18' },
] as const

/**
 * The 3–4 forms each role works with most often (agent_handoff §4 role
 * matrix). Drives the mobile bottom bar tiles, the floating quick-access
 * button, and the desktop "Your workspace" row.
 */
export const ROLE_PRIMARY_ACTIONS: Record<UserRole, readonly string[]> = {
  SUPER_ADMIN: ['/jo/new', '/mrs', '/transmittals', '/reports/expense'],
  MANAGER: ['/mrs/manager-queue', '/jo/queue', '/pms', '/admin/users'],
  BUDGET_OFFICER: ['/mrs/canvass', '/transmittals/create', '/jo/new', '/reports/expense'],
  ACCOUNTING: ['/transmittals/accounting', '/reports/expense', '/transmittals', '/audit-logs'],
  PURCHASER: ['/purchaser/queue', '/delivery/verify', '/mrs', '/transmittals'],
  STOREKEEPER: [], // retired by 0020 — the Record stays total, the role has no screens
  MAINTENANCE: ['/jo/new', '/jo/queue', '/pms', '/delivery/verify'],
  FRONT_DESK: ['/transmittals/front-desk', '/delivery/verify', '/jo/new', '/transmittals'],
  STAFF: ['/jo/new', '/jo/track', '/mrs/new'],
}

/** Every catalog route the role may view, in display order. */
export function getNavItemsForRole(role: UserRole): NavItem[] {
  return NAV_CATALOG.filter((item) => canViewRoute(role, item.href))
}

/** The role's primary forms (access-filtered, catalog order preserved). */
export function getPrimaryActionsForRole(role: UserRole): NavItem[] {
  const catalog = getNavItemsForRole(role)
  const byHref = new Map(catalog.map((item) => [item.href, item]))
  return (ROLE_PRIMARY_ACTIONS[role] ?? [])
    .map((href) => byHref.get(href))
    .filter((item): item is NavItem => Boolean(item))
}
