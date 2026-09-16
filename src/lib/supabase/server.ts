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
