// Pure feed-builder. No Deno/Node globals, no I/O — just data in, feed out,
// so it runs identically under Deno (edge) and Node (tests).
//
// PRIVACY INVARIANT: this module only ever receives calendar metadata and
// email *headers* (subject + sender). It must never copy an email body/snippet
// into its output. Tests assert this.

export type FeedEvent = {
  id: string
  title: string
  start: string
  end: string
  location: string | null
  joinUrl: string | null
  description: string | null
  movedFrom: string | null
  // 'meeting' = has other people or a join link; 'reminder' = all-day, a
  // focus/OOO block, or a solo timed item. Only meetings count toward the
  // "meetings" stat, though reminders still show on the calendar.
  kind: 'meeting' | 'reminder'
  attendees: { email: string; self: boolean; organizer: boolean; responseStatus: string | null }[]
}

export type EmailTask = {
  id: string
  title: string
  source: 'Email'
  meta: string
  due: string
  urgent?: boolean
  bucket: 'overdue' | 'today' | 'week'
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
  attendees?: { email?: string; self?: boolean; organizer?: boolean; responseStatus?: string }[]
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
      location: it.location ?? null,
      joinUrl,
      description: it.description ?? null,
      movedFrom: null,
      kind: classifyKind(it, joinUrl),
      attendees: (it.attendees ?? []).map((a) => ({
        email: a.email ?? '',
        self: a.self ?? false,
        organizer: a.organizer ?? false,
        responseStatus: a.responseStatus ?? null,
      })),
      }
    })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
}

// --- Gmail header metadata -> EmailTask. Receives ONLY subject + from (+ the
// List-Unsubscribe header, used purely as a bulk-mail signal — never stored). ---
type GmailMsg = { threadId: string; subject?: string; from?: string; listUnsubscribe?: string; unread?: boolean }

// Turn "Sarah Chen <sarah@x.com>" or "sarah@x.com" into a friendly display name.
function senderName(from: string | undefined): string {
  if (!from) return 'someone'
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</)
  if (m) return m[1].trim()
  return from.split('@')[0]
}

// Senders that never expect a personal reply — automated/transactional mail.
const AUTOMATED_FROM = /(no-?reply|do-?not-?reply|donotreply|no_reply|notifications?@|mailer-daemon|postmaster@|bounce[sd]?@)/i

// The default noise filter: an unread email becomes a task unless it's clearly
// bulk (carries a List-Unsubscribe header — newsletters, marketing, digests) or
// comes from an automated / no-reply sender. This is intentionally conservative
// so real "needs a reply" mail is never dropped; per-user allow/mute lists come
// later.
export function isActionableEmail(m: GmailMsg): boolean {
  if (m.listUnsubscribe && m.listUnsubscribe.trim()) return false
  if (m.from && AUTOMATED_FROM.test(m.from)) return false
  return true
}

export function buildEmailTasks(raw: { messages?: GmailMsg[] } | undefined | null): EmailTask[] {
  const messages = (raw?.messages ?? []).filter(isActionableEmail)
  return messages.slice(0, 6).map((m) => {
    const subject = (m.subject || '(no subject)').trim()
    return {
      id: 'mail:' + m.threadId,
      title: 'Reply: ' + subject,
      source: 'Email' as const,
      meta: 'from ' + senderName(m.from),
      due: 'today',
      bucket: 'today' as const,
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

// --- Final assembly ---
export function assemblePayload(args: {
  profile: { name: string; email: string; avatarUrl: string | null }
  brief: Brief | null
  events: FeedEvent[]
  emailTasks: EmailTask[]
  today: string
  now: Date
}): FeedPayload {
  return {
    generatedAt: args.now.toISOString(),
    profile: args.profile,
    brief: args.brief,
    days: { [args.today]: args.events },
    emailTasks: args.emailTasks,
  }
}
