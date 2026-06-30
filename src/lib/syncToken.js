// On first Google consent, Supabase hands us a `provider_refresh_token` in the
// session. We forward it (once) to the `store-token` Edge Function, which
// stashes it in Vault for the backend feed builder. Supabase only returns the
// refresh token on first consent, so this is naturally idempotent: when there's
// no token on the session (later sign-ins / refreshes) we do nothing.
import { SUPABASE_URL, GOOGLE_SCOPES } from './supabase.js'

const STORE_TOKEN_URL = `${SUPABASE_URL}/functions/v1/store-token`
const SCOPES = GOOGLE_SCOPES.split(' ').filter(Boolean)

function deviceTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export async function syncProviderToken(session) {
  const refresh = session?.provider_refresh_token
  const accessToken = session?.access_token
  if (!refresh || !accessToken) return

  try {
    const res = await fetch(STORE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ provider_refresh_token: refresh, scopes: SCOPES, tz: deviceTz() }),
    })
    if (!res.ok) {
      console.warn('[syncToken] store-token failed', res.status)
    }
  } catch (err) {
    // Never let a token-sync failure surface in the UI.
    console.warn('[syncToken] store-token error', err)
  }
}
