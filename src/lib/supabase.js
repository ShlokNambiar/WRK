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
  // PKCE so the OAuth redirect carries a short ?code= we exchange for a session
  // — cleaner over a native deep link than an implicit-flow token fragment.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
})

function isNative() {
  if (typeof window === 'undefined') return false
  try {
    const cap = window.Capacitor
    return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform())
  } catch { return false }
}

// Native (Capacitor) gets a deep-link redirect; web uses the current origin.
function redirectTo() {
  if (typeof window === 'undefined') return undefined
  return isNative() ? 'com.metis.wrk://auth' : window.location.origin
}

export async function signInWithGoogle() {
  const native = isNative()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GOOGLE_SCOPES,
      queryParams: { access_type: 'offline', prompt: 'consent' },
      redirectTo: redirectTo(),
      // On native we open the URL ourselves (Chrome Custom Tab) so the app's
      // webview stays alive to receive the deep-link return; the default would
      // navigate the webview away and it could never come back to a custom scheme.
      skipBrowserRedirect: native,
    },
  })
  if (error) throw error
  if (native && data?.url) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url: data.url })
  }
  return data
}

// Called from the native appUrlOpen handler with com.metis.wrk://auth?code=…
// Exchanges the code (PKCE verifier lives in this webview's storage) → session.
export async function completeOAuthRedirect(url) {
  let code = null
  try { code = new URL(url).searchParams.get('code') } catch {}
  if (!code) return
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  try { const { Browser } = await import('@capacitor/browser'); await Browser.close() } catch {}
  if (error) throw error
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
