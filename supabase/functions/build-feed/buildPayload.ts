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

export function buildEvents(raw: { items?: GCalItem[] } | undefined | null): FeedEvent[] {
  const items = raw?.items ?? []
  return items
    .filter((it) => it.status !== 'cancelled')
    .map((it) => ({
      id: it.id,
      title: it.summary || '(no title)',
      start: it.start?.dateTime ?? it.start?.date ?? '',
      end: it.end?.dateTime ?? it.end?.date ?? '',
      location: it.location ?? null,
      joinUrl: joinUrlOf(it),
      description: it.description ?? null,
      movedFrom: null,
      attendees: (it.attendees ?? []).map((a) => ({
        email: a.email ?? '',
        self: a.self ?? false,
        organizer: a.organizer ?? false,
        responseStatus: a.responseStatus ?? null,
      })),
    }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
}

// --- Gmail header metadata -> EmailTask. Receives ONLY subject + from. ---
type GmailMsg = { threadId: string; subject?: string; from?: string; unread?: boolean }

// Turn "Sarah Chen <sarah@x.com>" or "sarah@x.com" into a friendly display name.
function senderName(from: string | undefined): string {
  if (!from) return 'someone'
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</)
  if (m) return m[1].trim()
  return from.split('@')[0]
}

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
      bucket: 'today' as const,
    }
  })
}

// --- Deterministic, no-AI brief (Free tier) ---
export function templateBrief(events: { id?: string }[], emailTasks: { urgent?: boolean }[]): Brief {
  const nMeet = events.length
  const nTodo = emailTasks.length
  const nFlag = emailTasks.filter((t) => t.urgent).length
  const stats = [
    { n: String(nMeet), label: 'meetings' },
    { n: String(nTodo), label: 'to do' },
    { n: String(nFlag), label: 'flagged' },
  ]
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
