// Offline cache for the feed. The feed itself now comes from the signed-in
// user's own Supabase row (see providers/feed.js); we keep a last-good copy
// here for instant open / offline. SSR-safe localStorage wrapper.
const CACHE_KEY = 'wrk.feed.cache'  // last good payload, for offline / instant open

const ls = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch {} },
  del(k) { try { localStorage.removeItem(k) } catch {} },
}

export function readCache() {
  try { return JSON.parse(ls.get(CACHE_KEY) || 'null') } catch { return null }
}
export function writeCache(payload) {
  try { ls.set(CACHE_KEY, JSON.stringify(payload)) } catch {}
}
export function clearCache() { ls.del(CACHE_KEY) }
