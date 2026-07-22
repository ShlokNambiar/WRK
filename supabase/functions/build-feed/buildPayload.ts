// Pure feed-builder. No Deno/Node globals, no I/O — just data in, feed out,
// so it runs identically under Deno (edge) and Node (tests).
//
// PRIVACY INVARIANT: this module only ever receives calendar metadata and
// email *headers* (subject + sender). It must never copy an email body/snippet
// into its output. Tests assert this.
import { senderAddress } from './emailFilter.ts'

export type FeedEvent = {
  id: string
  title: string
  // For all-day events start/end are the raw YYYY-MM-DD date strings; timed
  // events carry full RFC3339 dateTimes. The client renders them separately.
  start: string
  end: string
  allDay: boolean
  location: string | null
  joinUrl: string | null
  description: string | null
  movedFrom: string | null
  // 'meeting' = has other people or a join link; 'reminder' = all-day, a
  // focus/OOO block, or a solo timed item. Only meetings count toward the
  // "meetings" stat, though reminders still show on the calendar.
  kind: 'meeting' | 'reminder'
  attendees: { email: string; name: string | null; self: boolean; organizer: boolean; responseStatus: string | null }[]
}

export type EmailTask = {
  id: string
  title: string
  source: 'Email'
  meta: string
  due: string
  urgent?: boolean
  bucket: 'overdue' | 'today' | 'week'
  // bare sender address — lets the app offer "mute this sender" (writes an
  // email_rules row) and deep-link back to the thread in Gmail
  sender: string
}

export type Brief = {
  runs: { text: string; emph?: boolean }[]
  stats: { n: string; label: string }[]
  text: string
}

export type FeedPayload = {
  generatedAt: string
  profile: { name: string; email: string; avatarUrl: string | null }
  brief: Brief | null
  days: Record<string, FeedEvent[]>
  emailTasks: EmailTask[]
}

// --- Google Calendar events.list item -> FeedEvent ---
type GCalItem = {
  id: string
  status?: string
  summary?: string
  location?: string
  description?: string
  hangoutLink?: string
  eventType?: string
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { email?: string; displayName?: string; self?: boolean; organizer?: boolean; responseStatus?: string }[]
}

function joinUrlOf(item: GCalItem): string | null {
  if (item.hangoutLink) return item.hangoutLink
  const video = item.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')
  return video?.uri || null
}

// Google eventTypes that are personal blocks, never meetings.
const NON_MEETING_TYPES = new Set(['focusTime', 'outOfOffice', 'workingLocation', 'birthday'])

function classifyKind(item: GCalItem, joinUrl: string | null): 'meeting' | 'reminder' {
  // all-day items (date, no dateTime) are reminders/holidays/blocks
  if (!item.start?.dateTime && item.start?.date) return 'reminder'
  // focus time / OOO / working-location / birthday are never meetings
  if (item.eventType && NON_MEETING_TYPES.has(item.eventType)) return 'reminder'
  // real meeting: someone else is on it, or there's a video link to join
  const hasOthers = (item.attendees ?? []).some((a) => !a.self)
  if (hasOthers || joinUrl) return 'meeting'
  // a solo timed block is a personal reminder, not a meeting
  return 'reminder'
}

export function buildEvents(raw: { items?: GCalItem[] } | undefined | null): FeedEvent[] {
  const items = raw?.items ?? []
  return items
    .filter((it) => it.status !== 'cancelled')
    .map((it) => {
      const joinUrl = joinUrlOf(it)
      return {
      id: it.id,
      title: it.summary || '(no title)',
      start: it.start?.dateTime ?? it.start?.date ?? '',
      end: it.end?.dateTime ?? it.end?.date ?? '',
      // all-day = date-only start (no dateTime); keeps the raw date string so
      // the client never renders it as a midnight/5:30 AM "meeting"
      allDay: !!(it.start?.date && !it.start?.dateTime),
      location: it.location ?? null,
      joinUrl,
      description: it.description ?? null,
      movedFrom: null,
      kind: classifyKind(it, joinUrl),
      attendees: (it.attendees ?? []).map((a) => ({
        email: a.email ?? '',
        name: a.displayName ?? null,
        self: a.self ?? false,
        organizer: a.organizer ?? false,
        responseStatus: a.responseStatus ?? null,
      })),
      }
    })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
}

// --- Gmail header metadata -> EmailTask. Receives ONLY subject + from. Pure
// mapper: which messages reach here is decided upstream (emailFilter + the AI
// actionability pass), so this just shapes the already-chosen ones into tasks. ---
type GmailMsg = { threadId: string; subject?: string; from?: string; listUnsubscribe?: string; unread?: boolean }

// Turn "Sarah Chen <sarah@x.com>" or "sarah@x.com" into a friendly display name.
function senderName(from: string | undefined): string {
  if (!from) return 'someone'
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</)
  if (m) return m[1].trim()
  return from.split('@')[0]
}

// Deterministic urgency cue in the subject line — feeds the "flagged" stat.
const URGENT_SUBJECT = /\b(urgent|asap|action required|deadline|eod|by (today|tomorrow|end of day)|overdue|final notice|reminder:)\b/i

export function buildEmailTasks(raw: { messages?: GmailMsg[] } | undefined | null): EmailTask[] {
  const messages = raw?.messages ?? []
  return messages.slice(0, 6).map((m) => {
    const subject = (m.subject || '(no subject)').trim()
    return {
      id: 'mail:' + m.threadId,
      title: 'Reply: ' + subject,
      source: 'Email' as const,
      meta: 'from ' + senderName(m.from),
      due: 'today',
      urgent: URGENT_SUBJECT.test(subject),
      bucket: 'today' as const,
      sender: senderAddress(m.from),
    }
  })
}

// The 3 headline counts. Meetings are counted by kind so a reminder/all-day/
// focus block never inflates the "meetings" number. Used both by templateBrief
// and to override an AI brief's stats, so the numbers are always authoritative.
export function computeStats(
  events: { kind?: string }[],
  emailTasks: { urgent?: boolean }[],
): { n: string; label: string }[] {
  const nMeet = events.filter((e) => e.kind === 'meeting').length
  const nTodo = emailTasks.length
  const nFlag = emailTasks.filter((t) => t.urgent).length
  return [
    { n: String(nMeet), label: 'meetings' },
    { n: String(nTodo), label: 'to do' },
    { n: String(nFlag), label: 'flagged' },
  ]
}

// --- Deterministic, no-AI brief (Free tier) ---
export function templateBrief(events: { kind?: string }[], emailTasks: { urgent?: boolean }[]): Brief {
  const stats = computeStats(events, emailTasks)
  const nMeet = Number(stats[0].n)
  const nTodo = Number(stats[1].n)
  let lead: string
  if (nMeet === 0 && nTodo === 0) lead = 'A clear day — nothing on the calendar and a quiet inbox.'
  else if (nMeet === 0) lead = 'No meetings today.'
  else lead = `${nMeet} meeting${nMeet > 1 ? 's' : ''} today.`
  const tail = nTodo > 0 ? ` ${nTodo} email${nTodo > 1 ? 's' : ''} to look at.` : ''
  const runs = [{ text: lead }]
  if (tail) runs.push({ text: tail.trim() })
  return { runs, stats, text: (lead + tail).trim() }
}

// --- timezone guard ---
// profiles.tz is device/user-supplied; a garbage value makes every
// Intl.DateTimeFormat call below throw and would kill the whole build. Every
// tz consumer routes through safeTz (the builder does it once, where tz is
// read off the profile row): validate, fall back to the app default.
export const DEFAULT_TZ = 'Asia/Kolkata'
export function safeTz(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return DEFAULT_TZ
  }
}

// --- 7-day grouping ---
// en-CA gives YYYY-MM-DD — the day-key format the client indexes by.
export function dayKeyInTz(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

// Group the week's events into a days map keyed by the LOCAL date of each
// event's start. ALL 7 keys (today .. today+6) are always present — an empty
// array means a genuinely free day (the client uses non-empty length for its
// "has events" dots). Multi-day events live under their start date only; an
// already-running event that started before today is shown under today so an
// ongoing block (e.g. a vacation) doesn't vanish from the feed.
export function groupEventsByDay(events: FeedEvent[], now: Date, tz: string): Record<string, FeedEvent[]> {
  // 7 consecutive calendar dates starting at the user's local today. Stepping
  // whole UTC dates (not now + n*24h) keeps the keys distinct across DST shifts.
  const keys: string[] = []
  const cursor = new Date(dayKeyInTz(now, tz) + 'T00:00:00Z')
  for (let i = 0; i < 7; i++) {
    keys.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  const days: Record<string, FeedEvent[]> = Object.fromEntries(keys.map((k) => [k, []]))
  for (const ev of events) {
    // all-day starts are already local YYYY-MM-DD; timed starts get converted
    const key = ev.allDay ? ev.start.slice(0, 10) : ev.start ? dayKeyInTz(new Date(ev.start), tz) : keys[0]
    if (days[key]) days[key].push(ev)
    else if (key < keys[0]) days[keys[0]].push(ev) // started before today, still running
    // starts past the window (shouldn't happen — the fetch is bounded) are dropped
  }
  // buildEvents sorts globally, but the started-before-today clamp can prepend
  // out of order — keep each day sorted by start.
  for (const k of keys) days[k].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  return days
}

// --- movedFrom diff against the previous feed ---
// "h:mm AM/PM" in the user's tz, e.g. "3:00 PM" — what the client shows as
// "moved from 3:00 PM".
function clockTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso))
    .replace(/\u202f/g, ' ') // newer ICU uses a narrow no-break space before AM/PM
}

// Mark events whose start changed since the previous build. Looks the event id
// up across ALL days of the old payload (a move can cross days). Only timed →
// timed changes count: all-day events have no clock time to have "moved from".
// Mutates nothing — returns new event objects where movedFrom is set.
export function applyMovedFrom(events: FeedEvent[], oldPayload: FeedPayload | null | undefined, tz: string): FeedEvent[] {
  const oldById = new Map<string, FeedEvent>()
  for (const day of Object.values(oldPayload?.days ?? {})) {
    for (const ev of day) oldById.set(ev.id, ev)
  }
  return events.map((ev) => {
    const old = oldById.get(ev.id)
    if (!old || ev.allDay || old.allDay) return ev
    // guard: older payloads predate the allDay flag, so also require a real
    // dateTime (all-day starts are bare dates with no 'T')
    if (!old.start?.includes('T') || !ev.start.includes('T')) return ev
    if (Date.parse(old.start) === Date.parse(ev.start)) return ev
    return { ...ev, movedFrom: clockTime(old.start, tz) }
  })
}

// --- hourly cron: who is due right now? ---
// The hourly job fires at minute 0 every hour; a user builds when their CURRENT
// LOCAL HOUR (from profiles.tz) equals their chosen brief_hour. Pure so it's
// unit-testable with fake clocks.
export function usersDueNow<T extends { tz: string; brief_hour: number }>(users: T[], now: Date): T[] {
  return users.filter((u) => {
    // safeTz: a corrupt tz string falls back to the app default rather than never building
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: safeTz(u.tz), hour: '2-digit', hourCycle: 'h23' }).format(now))
    return hour === u.brief_hour
  })
}

// --- who gets the email pipeline? ---
// Pro tier AND the user hasn't switched email tasks off
// (profiles.email_tasks_enabled). When this is false the builder skips the
// Gmail fetch entirely (emailTasks = []); the Pro AI brief itself is keyed on
// tier alone and still runs, from calendar only.
export function emailTasksAllowed(u: { tier: string; email_tasks_enabled?: boolean }): boolean {
  return u.tier === 'pro' && u.email_tasks_enabled !== false
}

// --- user-invoked rebuild rate limit ---
// One rebuild per 10 minutes, keyed on feeds.last_rebuild_at — which the
// builder stamps BEFORE any outbound work. (It used to key on updated_at,
// which only moved on a successful build, so error paths allowed unlimited
// retries hammering Google + the AI provider.) Returns 0 when allowed, else
// the number of whole seconds until the window reopens (the 429 retryAfter).
export const REBUILD_WINDOW_MS = 10 * 60 * 1000
export function rateLimitRetryAfter(lastRebuildAt: string | null | undefined, now: Date, windowMs = REBUILD_WINDOW_MS): number {
  if (!lastRebuildAt) return 0
  const elapsed = now.getTime() - Date.parse(lastRebuildAt)
  if (Number.isNaN(elapsed) || elapsed >= windowMs) return 0
  return Math.ceil((windowMs - elapsed) / 1000)
}

// --- Final assembly ---
export function assemblePayload(args: {
  profile: { name: string; email: string; avatarUrl: string | null }
  brief: Brief | null
  days: Record<string, FeedEvent[]>
  emailTasks: EmailTask[]
  now: Date
}): FeedPayload {
  return {
    generatedAt: args.now.toISOString(),
    profile: args.profile,
    brief: args.brief,
    days: args.days,
    emailTasks: args.emailTasks,
  }
}
