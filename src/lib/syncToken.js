// On first Google consent, Supabase hands us a `provider_refresh_token` in the
// session. We forward it to the `store-token` Edge Function, which stashes it
// in Vault for the backend feed builder. Supabase only returns the refresh
// token on first consent, so a failed POST here used to brick the account: the
// backend never learns the token exists, no feed is ever built, and the app
// sits at "Preparing your feed" forever. Now we retry with backoff and track a
// persisted synced-flag so the UI can say "setup didn't finish" instead.
import { SUPABASE_URL, GOOGLE_SCOPES } from './supabase.js'

const STORE_TOKEN_URL = `${SUPABASE_URL}/functions/v1/store-token`
const SCOPES = GOOGLE_SCOPES.split(' ').filter(Boolean)
const SYNC_FLAG = 'wrk.tokenSynced' // '1' once the backend has confirmed a token

function deviceTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

// Has the backend ever confirmed receipt of a refresh token for this install?
// Also marked true whenever a built feed is observed (feed exists ⇒ token did).
export function tokenSyncOk() {
  try { return localStorage.getItem(SYNC_FLAG) === '1' } catch { return true }
}
export function markTokenSynced() {
  try { localStorage.setItem(SYNC_FLAG, '1') } catch {}
}
export function clearTokenSynced() {
  try { localStorage.removeItem(SYNC_FLAG) } catch {}
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Returns true once the token is stored (or when there was nothing to store).
export async function syncProviderToken(session) {
  const refresh = session?.provider_refresh_token
  const accessToken = session?.access_token
  if (!refresh || !accessToken) return false

  // Three attempts with backoff: the common failure is a network blip in the
  // seconds right after the OAuth redirect.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await wait(attempt * 2000)
    try {
      const res = await fetch(STORE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ provider_refresh_token: refresh, scopes: SCOPES, tz: deviceTz() }),
      })
      if (res.ok) {
        markTokenSynced()
        return true
      }
      console.warn('[syncToken] store-token failed', res.status)
    } catch (err) {
      console.warn('[syncToken] store-token error', err)
    }
  }
  return false
}
