// Tiny localStorage wrapper with graceful fallback (private mode / SSR).
//
// State is scoped per OWNER (Supabase user id, or 'anon' when signed out) so
// two accounts on one device can never see each other's tasks. Legacy v1 data
// (single global key) is migrated into the first owner who loads it.
const LEGACY_KEY = 'wrk-app.v1'
const keyFor = (owner) => `wrk-app.v2:${owner || 'anon'}`

export function loadState(owner) {
  try {
    const raw = localStorage.getItem(keyFor(owner))
    if (raw) return JSON.parse(raw)
    // one-time migration: adopt the pre-multiuser blob, then remove it so a
    // different account signing in later can't inherit it too
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy)
      localStorage.setItem(keyFor(owner), legacy)
      localStorage.removeItem(LEGACY_KEY)
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export function saveState(owner, state) {
  try {
    localStorage.setItem(keyFor(owner), JSON.stringify(state))
  } catch {}
}

export function clearState(owner) {
  try {
    localStorage.removeItem(keyFor(owner))
  } catch {}
}
