// The app's single data source: a JSON "feed" produced by a scheduled Claude
// routine. No Google OAuth in the app. Offline-first: returns cached data
// instantly and a labeled demo until a feed URL is configured.
//
// Feed payload shape (see WRK_FEED.md):
// {
//   generatedAt: ISO,
//   profile: { name, email, avatarUrl },
//   brief:   { runs:[{text,emph?}], stats:[{n,label}], text } | null,  // for "today"
//   days:    { "YYYY-MM-DD": [FeedEvent, ...] },
//   emailTasks: [ { id, title, source:'Email', meta, due, urgent?, bucket } ]
// }
// FeedEvent: { id, title, start: ISO, end: ISO, location?, joinUrl?, description?,
//              movedFrom?, attendees?: [{ email, self?, responseStatus? }] }
import { normalizeEvent } from './calendar.js'
import { readCache, writeCache } from '../lib/feedConfig.js'
import { supabase } from '../lib/supabase.js'

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// FeedEvent (friendly) -> the Google-ish shape normalizeEvent expects.
function toGoogle(e) {
  return {
    id: e.id, summary: e.title, description: e.description, location: e.location,
    start: { dateTime: e.start }, end: { dateTime: e.end },
    hangoutLink: e.joinUrl || undefined,
    attendees: (e.attendees || []).map((a) => ({
      email: a.email, self: a.self, organizer: a.organizer,
      responseStatus: a.self ? (a.responseStatus || e.responseStatus) : a.responseStatus,
    })),
    _movedFrom: e.movedFrom,
  }
}

export function normalizeDay(rawEvents = []) {
  return rawEvents.map((e) => normalizeEvent(toGoogle(e))).sort((a, b) => a.start - b.start)
}

// ---- demo payload (clearly labeled; shown only until a feed is configured) ----
function at(now, h, m) { const d = new Date(now); d.setHours(h, m, 0, 0); return d.toISOString() }
export function getDemoPayload(now = new Date()) {
  const key = isoDate(now)
  return {
    generatedAt: now.toISOString(),
    profile: { name: 'Alex', email: 'demo@wrk.app', avatarUrl: null },
    brief: null,
    days: {
      [key]: [
        { id: 'd_standup', title: 'Daily standup', start: at(now, 9, 30), end: at(now, 9, 45), joinUrl: 'https://zoom.us/j/0', attendees: [{ email: 'you', self: true }, { email: 'a' }, { email: 'b' }, { email: 'c' }, { email: 'd' }, { email: 'e' }] },
        { id: 'd_design', title: 'Design review', start: at(now, 11, 0), end: at(now, 11, 45), location: 'Room 3B', description: 'Doc: https://docs.example.com/v2', attendees: [{ email: 'you', self: true }, { email: 'l' }, { email: 'p' }, { email: 'e' }] },
        { id: 'd_acme', title: 'Acme quarterly review', start: at(now, 15, 0), end: at(now, 16, 0), location: 'Conf A', movedFrom: '2:00', attendees: [{ email: 'you', self: true }, { email: 'c' }, { email: 'v' }] },
        { id: 'd_1on1', title: '1:1 with Priya', start: at(now, 16, 30), end: at(now, 17, 0), joinUrl: 'https://meet.google.com/x', responseStatus: 'needsAction', attendees: [{ email: 'you', self: true, responseStatus: 'needsAction' }, { email: 'priya', organizer: true }] },
      ],
    },
    emailTasks: [
      { id: 'mail:sarah', title: 'Reply to Sarah re: contract', source: 'Email', meta: 'from Sarah Chen', due: '10am', urgent: true, bucket: 'overdue' },
      { id: 'mail:pr', title: 'Approve design-tokens PR', source: 'Email', meta: 'from GitHub', due: 'today', bucket: 'today' },
      { id: 'mail:q3', title: 'Send Q3 numbers to finance', source: 'Email', meta: 'from Priya', due: 'Thu', bucket: 'week' },
    ],
  }
}

// Fetch the feed. Returns { payload, meta:{ demo, stale, error, needsReauth } }.
//
// When a Supabase user is signed in, read THAT user's own `feeds` row (RLS
// scopes the query to them). Logged-out / empty / error all fall back to the
// cache and finally the labeled demo payload, exactly as before.
// A signed-in user's real identity from the Supabase auth user, so a
// not-yet-built feed never shows the demo person ("Alex" / demo@wrk.app).
function realProfile(user) {
  return {
    name: user?.user_metadata?.full_name || user?.user_metadata?.name || '',
    email: user?.email || '',
    avatarUrl: user?.user_metadata?.avatar_url || null,
  }
}
// Demo sample content, but wearing the signed-in user's real profile.
function signedInDemo(now, user) {
  return { ...getDemoPayload(now), profile: realProfile(user) }
}

export async function getFeed(now = new Date()) {
  const base = { demo: false, stale: false, error: false, needsReauth: false }

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data?.user || null
  } catch {
    user = null
  }

  // Logged out → demo (signing in via Account is the path to a real feed).
  if (!user) {
    return { payload: getDemoPayload(now), meta: { ...base, demo: true } }
  }

  try {
    const { data: row, error } = await supabase
      .from('feeds')
      .select('payload, needs_reauth')
      .maybeSingle()
    if (error) throw error

    const needsReauth = !!row?.needs_reauth
    const data = row?.payload || null

    // No feed built yet (or malformed) → cache, else demo (with the real
    // profile). Still surface reauth.
    if (!data || !data.days) {
      const cached = readCache()
      if (cached) return { payload: cached, meta: { ...base, stale: true, needsReauth } }
      return { payload: signedInDemo(now, user), meta: { ...base, demo: true, needsReauth } }
    }

    writeCache(data)
    return { payload: data, meta: { ...base, needsReauth } }
  } catch {
    const cached = readCache()
    if (cached) return { payload: cached, meta: { ...base, stale: true, error: true } }
    return { payload: signedInDemo(now, user), meta: { ...base, demo: true, error: true } }
  }
}
