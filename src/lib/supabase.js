// Supabase client + auth helpers. The app signs in with Google (calendar +
// gmail read-only) and reads each user's own feed row (RLS-scoped). The anon
// key is public/read-only — safe to embed. SSR-safe: all window/Capacitor
// access is guarded so the headless render harness never throws.
import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://qztghidtbaucvknavjon.supabase.co'
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dGdoaWR0YmF1Y3ZrbmF2am9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NjUzNDAsImV4cCI6MjA5ODE0MTM0MH0.Q3yv2QynVDBoAQMU5LIpdXNbeRmJefEOngyBBJKPc3g'

// Google OAuth scopes the backend needs to build the per-user feed.
export const GOOGLE_SCOPES =
  'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

// Native (Capacitor) gets a deep-link redirect; web uses the current origin.
function redirectTo() {
  if (typeof window === 'undefined') return undefined
  try {
    const cap = window.Capacitor
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
      return 'life.pepl.wrk://auth'
    }
  } catch {}
  return window.location.origin
}

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GOOGLE_SCOPES,
      queryParams: { access_type: 'offline', prompt: 'consent' },
      redirectTo: redirectTo(),
    },
  })
}

export function signOut() {
  return supabase.auth.signOut()
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data?.session || null
}

export async function getUser() {
  const { data } = await supabase.auth.getUser()
  return data?.user || null
}

// cb receives (event, session). Returns the subscription so callers can unsubscribe.
export function onAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(event, session))
  return data?.subscription || { unsubscribe() {} }
}
