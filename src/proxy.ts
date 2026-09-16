import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/database.types'
import type { UserRole } from '@/types/index'

// ---------------------------------------------------------------------------
// Route → required role(s) map
// Order matters: more-specific prefixes first.
// ---------------------------------------------------------------------------
const ROUTE_ROLE_MAP: { prefix: string; roles: UserRole[] }[] = [
  // Job Orders
  { prefix: '/jo', roles: ['SUPER_ADMIN','MANAGER','MAINTENANCE','STAFF','FRONT_DESK','BUDGET_OFFICER','ACCOUNTING','PURCHASER','STOREKEEPER'] },
  // MRS flows
  { prefix: '/mrs/stock-check',    roles: ['SUPER_ADMIN','STOREKEEPER'] },
  { prefix: '/mrs/manager-queue',  roles: ['SUPER_ADMIN','MANAGER'] },
  { prefix: '/mrs/canvass',        roles: ['SUPER_ADMIN','BUDGET_OFFICER'] },
  { prefix: '/mrs',                roles: ['SUPER_ADMIN','MANAGER','MAINTENANCE','STAFF','FRONT_DESK','BUDGET_OFFICER','ACCOUNTING','PURCHASER','STOREKEEPER'] },
  // Financial transmittals
  { prefix: '/transmittals/accounting', roles: ['SUPER_ADMIN','ACCOUNTING'] },
  { prefix: '/transmittals/front-desk', roles: ['SUPER_ADMIN','FRONT_DESK','BUDGET_OFFICER'] },
  { prefix: '/transmittals',            roles: ['SUPER_ADMIN','ACCOUNTING','BUDGET_OFFICER','FRONT_DESK','PURCHASER','MANAGER'] },
  // Purchaser queue
  { prefix: '/purchaser',  roles: ['SUPER_ADMIN','PURCHASER'] },
  // Delivery verification
  { prefix: '/delivery',   roles: ['SUPER_ADMIN','PURCHASER','FRONT_DESK','MAINTENANCE','STOREKEEPER'] },
  // PMS
  { prefix: '/pms',        roles: ['SUPER_ADMIN','MANAGER','MAINTENANCE'] },
  // Reports
  { prefix: '/reports',    roles: ['SUPER_ADMIN','MANAGER','ACCOUNTING','BUDGET_OFFICER'] },
  // Admin / User management
  { prefix: '/admin',      roles: ['SUPER_ADMIN','MANAGER'] },
  // Dashboard root — any authenticated user
  { prefix: '/dashboard',  roles: ['SUPER_ADMIN','MANAGER','MAINTENANCE','STAFF','FRONT_DESK','BUDGET_OFFICER','ACCOUNTING','PURCHASER','STOREKEEPER'] },
]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Build a response we can mutate to refresh session cookies
  let response = NextResponse.next({ request })

  // Create a Supabase server client that can update session cookies on the
  // response (uses getAll/setAll — NOT the deprecated get/set/remove pattern).
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write refreshed cookies to both the forwarded request and the
          // outgoing response so the session survives across renders.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the session — IMPORTANT: always call getUser() in proxy so that
  // the session cookie is kept fresh and JWTs are not served stale.
  const { data: { user } } = await supabase.auth.getUser()

  // ── Unauthenticated access to protected routes ──────────────────────────
  const isProtected = ROUTE_ROLE_MAP.some(({ prefix }) =>
    pathname.startsWith(prefix)
  )

  if (isProtected && !user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirectedFrom', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // ── Authenticated users trying to visit /login ───────────────────────────
  if (pathname === '/login' && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // ── Root route redirect ──────────────────────────────────────────────────
  if (pathname === '/') {
    if (user) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // ── Role-based access control ─────────────────────────────────────────────
  if (user && isProtected) {
    // Fetch user role from the users table (the auth.users row only has email)
    const { data: profile } = await supabase
      .from('users')
      .select('role, account_status')
      .eq('id', user.id)
      .single()

    // Block INACTIVE accounts immediately
    if (!profile || profile.account_status === 'INACTIVE') {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL('/login?error=account_inactive', request.url))
    }

    // Check route-level role requirement
    const rule = ROUTE_ROLE_MAP.find(({ prefix }) => pathname.startsWith(prefix))
    if (rule && !rule.roles.includes(profile.role as UserRole)) {
      return NextResponse.redirect(new URL('/dashboard?error=forbidden', request.url))
    }

    // Pass the user's role downstream via a request header so Server Components
    // can read it without a second DB round-trip (Plan.md §10 guardrail: verify
    // auth inside Server Functions too — headers are a convenience supplement,
    // not the sole guard).
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-user-id',   user.id)
    requestHeaders.set('x-user-role', profile.role)
    response = NextResponse.next({
      request: { headers: requestHeaders },
    })
    // Re-apply any cookie mutations from the session refresh above
  }

  return response
}

// Run on all routes except Next.js internals and static assets
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
