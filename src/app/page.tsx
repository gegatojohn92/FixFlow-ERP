import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      redirect('/dashboard')
    }
  } catch (err: unknown) {
    // If Supabase is uninitialized or session check fails, fall through to login
  }

  redirect('/login')
}
