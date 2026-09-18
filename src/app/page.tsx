import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/supabase/server'

export default async function HomePage() {
  // getServerUser() never throws — a stale/rotated session or transient
  // network failure is treated as signed out and resolves straight to /login
  // instead of crashing the render. (The proxy already redirects signed-in
  // users off "/", so this is the second line of defense.)
  const user = await getServerUser()

  if (user) {
    redirect('/dashboard')
  }

  redirect('/login')
}
