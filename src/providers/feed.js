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
    // all-day events keep bare dates so normalizeEvent parses them as local days
    start: e.allDay ? { date: e.start } : { dateTime: e.start },
    end: e.allDay ? { date: e.end } : { dateTime: e.end },
    hangoutLink: e.joinUrl || undefined,
    attendees: (e.attendees || []).map((a) => ({
      email: a.email, displayName: a.name || undefined, self: a.self, organizer: a.organizer,
      responseStatus: a.self ? (a.responseStatus || e.responseStatus) : a.responseStatus,
    })),
    _movedFrom: e.movedFrom,
    _allDay: !!e.allDay,
    _kind: e.kind || null,
  }
}

export function normalizeDay(rawEvents = []) {
  return rawEvents.map((e) => normalizeEvent(toGoogle(e))).sort((a, b) => a.start - b.start)
}

// ---- demo payload (clearly labeled; shown only until a feed is configured) ----
function at(now, h, m, plusDays = 0) { const d = new Date(now); d.setDate(d.getDate() + plusDays); d.setHours(h, m, 0, 0); return d.toISOString() }
function dayKey(now, plusDays) { const d = new Date(now); d.setDate(d.getDate() + plusDays); return isoDate(d) }
export function getDemoPayload(now = new Date()) {
  const key = isoDate(now)
  return {
    generatedAt: now.toISOString(),
    profile: { name: 'Alex', email: 'demo@wrk.app', avatarUrl: null },
    brief: null,
    days: {
      [key]: [
        { id: 'd_standup', title: 'Daily standup', kind: 'meeting', start: at(now, 9, 30), end: at(now, 9, 45), joinUrl: 'https://zoom.us/j/0', attendees: [{ email: 'you', self: true }, { email: 'ana@acme.co', name: 'Ana' }, { email: 'ben@acme.co', name: 'Ben' }, { email: 'cy@acme.co' }, { email: 'dev@acme.co' }, { email: 'eve@acme.co' }] },
        { id: 'd_design', title: 'Design review', kind: 'meeting', start: at(now, 11, 0), end: at(now, 11, 45), location: 'Room 3B', description: 'Doc: https://docs.example.com/v2', attendees: [{ email: 'you', self: true }, { email: 'lea@acme.co', name: 'Lea' }, { email: 'pat@acme.co' }, { email: 'eli@acme.co' }] },
        { id: 'd_acme', title: 'Acme quarterly review', kind: 'meeting', start: at(now, 15, 0), end: at(now, 16, 0), location: 'Conf A', movedFrom: '2:00 PM', attendees: [{ email: 'you', self: true }, { email: 'cfo@acme.co', name: 'Casey' }, { email: 'vp@acme.co' }] },
        { id: 'd_1on1', title: '1:1 with Priya', kind: 'meeting', start: at(now, 16, 30), end: at(now, 17, 0), joinUrl: 'https://meet.google.com/x', responseStatus: 'needsAction', attendees: [{ email: 'you', self: true, responseStatus: 'needsAction' }, { email: 'priya@acme.co', name: 'Priya', organizer: true }] },
      ],
      // a browsable week so the calendar demo isn't a dead strip
      [dayKey(now, 1)]: [
        { id: 'd_focus', title: 'Focus block — roadmap doc', kind: 'reminder', start: at(now, 10, 0, 1), end: at(now, 12, 0, 1), attendees: [] },
        { id: 'd_intro', title: 'Intro call — Northwind', kind: 'meeting', start: at(now, 14, 0, 1), end: at(now, 14, 30, 1), joinUrl: 'https://meet.google.com/y', attendees: [{ email: 'you', self: true }, { email: 'sam@northwind.io', name: 'Sam' }] },
      ],
      [dayKey(now, 2)]: [
        { id: 'd_offsite', title: 'Team offsite', kind: 'reminder', allDay: true, start: dayKey(now, 2), end: dayKey(now, 3), attendees: [] },
      ],
      [dayKey(now, 3)]: [],
      [dayKey(now, 4)]: [
        { id: 'd_retro', title: 'Sprint retro', kind: 'meeting', start: at(now, 11, 30, 4), end: at(now, 12, 15, 4), joinUrl: 'https://zoom.us/j/1', attendees: [{ email: 'you', self: true }, { email: 'ana@acme.co', name: 'Ana' }, { email: 'ben@acme.co' }] },
      ],
      [dayKey(now, 5)]: [],
      [dayKey(now, 6)]: [],
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
// Signed in, but the backend hasn't built this user's feed yet. Show THEIR
// identity with an empty day — never the demo person's fabricated schedule,
// which would look real once it sits under the user's own name.
function pendingPayload(now, user) {
  return { generatedAt: now.toISOString(), profile: realProfile(user), brief: null, days: {}, emailTasks: [] }
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

    // No feed built yet (or malformed) → cache, else a "preparing" empty state
    // with the real profile. Still surface reauth.
    if (!data || !data.days) {
      const cached = readCache()
      if (cached) return { payload: cached, meta: { ...base, stale: true, needsReauth } }
      return { payload: pendingPayload(now, user), meta: { ...base, pending: true, needsReauth } }
    }

    writeCache(data)
    return { payload: data, meta: { ...base, needsReauth } }
  } catch {
    const cached = readCache()
    if (cached) return { payload: cached, meta: { ...base, stale: true, error: true } }
    return { payload: pendingPayload(now, user), meta: { ...base, pending: true, error: true } }
  }
}
