// Reads the current user's tier from the `entitlements` table (RLS-scoped to
// the logged-in user). Defaults to 'free' when logged out, missing, or on error.
import { supabase } from '../lib/supabase.js'

export async function getTier() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return 'free'
    const { data, error } = await supabase
      .from('entitlements')
      .select('tier')
      .maybeSingle()
    if (error || !data) return 'free'
    return data.tier === 'pro' ? 'pro' : 'free'
  } catch {
    return 'free'
  }
}
