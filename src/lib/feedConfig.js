// Where the app reads its day from. The feed is a single JSON document produced
// by a scheduled Claude routine (see WRK_FEED.md). Transport-agnostic: any URL
// that returns the feed payload (Supabase REST, a gist, a worker, …).
const URL_KEY = 'wrk.feed.url'
const KEY_KEY = 'wrk.feed.key'      // optional bearer/apikey sent as a header
const CACHE_KEY = 'wrk.feed.cache'  // last good payload, for offline / instant open

// Shipped defaults so a fresh install "just works" — the WRK Supabase feed,
// updated daily by the Claude routine. The anon key is read-only (RLS), safe to embed.
const DEFAULT_URL = 'https://qztghidtbaucvknavjon.supabase.co/rest/v1/feed?id=eq.today&select=payload'
const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dGdoaWR0YmF1Y3ZrbmF2am9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NjUzNDAsImV4cCI6MjA5ODE0MTM0MH0.Q3yv2QynVDBoAQMU5LIpdXNbeRmJefEOngyBBJKPc3g'

const ls = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch {} },
  del(k) { try { localStorage.removeItem(k) } catch {} },
}

export function getFeedUrl() { return ls.get(URL_KEY) || DEFAULT_URL }
export function setFeedUrl(v) { v ? ls.set(URL_KEY, v.trim()) : ls.del(URL_KEY) }

export function getFeedKey() { return ls.get(KEY_KEY) || DEFAULT_KEY }
export function setFeedKey(v) { v ? ls.set(KEY_KEY, v.trim()) : ls.del(KEY_KEY) }

export function isFeedConfigured() { return !!getFeedUrl() }

export function readCache() {
  try { return JSON.parse(ls.get(CACHE_KEY) || 'null') } catch { return null }
}
export function writeCache(payload) {
  try { ls.set(CACHE_KEY, JSON.stringify(payload)) } catch {}
}
export function clearFeed() { ls.del(URL_KEY); ls.del(KEY_KEY); ls.del(CACHE_KEY) }
