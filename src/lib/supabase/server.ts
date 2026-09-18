import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database.types'

/**
 * Server-side Supabase client for use in Server Components, Server Actions,
 * and Route Handlers. Uses getAll/setAll cookie methods (not the deprecated
 * get/set/remove) as required by @supabase/ssr docs.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component — cookies can only be
            // mutated from Server Actions or Route Handlers. This is safe to
            // ignore if you have a proxy.ts (proxy.js) refreshing sessions.
          }
        },
      },
    }
  )
}

/**
 * Safely resolve the currently signed-in user on the server.
 *
 * `supabase.auth.getUser()` performs a network call to the Supabase Auth
 * server and can THROW (instead of returning `{ error }`) when the stored
 * session cannot be validated or refreshed — an expired/rotated refresh
 * token, or a transient network failure reaching the auth server. An
 * uncaught throw inside a Server Component crashes the entire RSC render,
 * which in production surfaces as the opaque "Minified React error #441"
 * even though the user's data was saved fine. Treating any failure as
 * "signed out" lets callers redirect to /login instead of crashing the page.
 */
export async function getServerUser() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user
  } catch (err) {
    // Expected at build time (static render attempts throw "Dynamic server
    // usage" before the route opts into dynamic rendering) — stay quiet.
    if (err instanceof Error && /Dynamic server usage/.test(err.message)) return null
    console.error('[supabase] Could not resolve server session; treating as signed out:', err)
    return null
  }
}
