// Per-user cloud data beyond the feed: sender curation rules, profile prefs
// (timezone + brief hour), a backup of local task state, and the on-demand
// feed rebuild. All RLS-scoped to the signed-in user; every call is safe to
// fire signed-out (it just no-ops or rejects quietly).
import { supabase, SUPABASE_URL } from './supabase.js'

// ---- sender curation (email_rules: mode 'mute' | 'allow') ----
export async function listEmailRules() {
  const { data, error } = await supabase.from('email_rules').select('sender, mode, created_at').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function setEmailRule(sender, mode) {
  const clean = String(sender || '').trim().toLowerCase()
  if (!clean) return
  const { data: u } = await supabase.auth.getUser()
  if (!u?.user) return
  const { error } = await supabase.from('email_rules').upsert(
    { user_id: u.user.id, sender: clean, mode },
    { onConflict: 'user_id,sender' },
  )
  if (error) throw error
}

export async function removeEmailRule(sender) {
  const { error } = await supabase.from('email_rules').delete().eq('sender', sender)
  if (error) throw error
}

// ---- profile prefs ----
// Keep tz current on every launch (it was previously written only on first
// consent, so travelers got feeds keyed to a stale timezone forever) and let
// the user pick the hour their brief is built.
export async function syncProfilePrefs({ briefHour } = {}) {
  try {
    const { data: u } = await supabase.auth.getUser()
    if (!u?.user) return false
    const patch = { tz: Intl.DateTimeFormat().resolvedOptions().timeZone }
    if (Number.isInteger(briefHour) && briefHour >= 0 && briefHour <= 23) patch.brief_hour = briefHour
    const { error } = await supabase.from('profiles').update(patch).eq('id', u.user.id)
    return !error
  } catch {
    return false
  }
}

// ---- task-state backup (user_state: one jsonb row per user) ----
// Tasks stay local-first; this is the "lost my phone" safety net. Push is
// debounced by the caller; pull happens once per sign-in.
export async function pushTaskState(state) {
  try {
    const { data: u } = await supabase.auth.getUser()
    if (!u?.user) return false
    const { error } = await supabase.from('user_state').upsert(
      { user_id: u.user.id, state, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    return !error
  } catch {
    return false
  }
}

export async function pullTaskState() {
  try {
    const { data, error } = await supabase.from('user_state').select('state, updated_at').maybeSingle()
    if (error || !data) return null
    return data
  } catch {
    return null
  }
}

// ---- on-demand feed rebuild ----
// POSTs the user's own JWT to build-feed, which rebuilds just their row
// (rate-limited server-side). Returns 'built' | 'rate_limited' | 'error'.
export async function rebuildFeed() {
  try {
    const { data: s } = await supabase.auth.getSession()
    const token = s?.session?.access_token
    if (!token) return 'error'
    const res = await fetch(`${SUPABASE_URL}/functions/v1/build-feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{}',
    })
    if (res.status === 429) return 'rate_limited'
    return res.ok ? 'built' : 'error'
  } catch {
    return 'error'
  }
}
