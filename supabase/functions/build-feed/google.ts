// Google token refresh + read-only Calendar/Gmail fetch.
// fetch is injectable (last arg) so the pure HTTP shaping is unit-testable
// under Node without network. PRIVACY: Gmail is fetched with format=metadata
// and only the Subject + From headers — message bodies are never requested.

export class TokenRevokedError extends Error {
  constructor(msg = 'google refresh token revoked') {
    super(msg)
    this.name = 'TokenRevokedError'
  }
}

type FetchFn = typeof fetch

// --- pure: today's [start,end) in the user's timezone as RFC3339 with offset ---
function offsetFor(now: Date, tz: string): string {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00'
  const m = s.match(/GMT([+-])(\d{2}):?(\d{2})/)
  return m ? `${m[1]}${m[2]}:${m[3]}` : '+00:00'
}

function dateInTz(now: Date, tz: string): string {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function todayBounds(now: Date, tz: string): { date: string; timeMin: string; timeMax: string } {
  const date = dateInTz(now, tz)
  const offset = offsetFor(now, tz)
  const next = new Date(date + 'T00:00:00Z')
  next.setUTCDate(next.getUTCDate() + 1)
  const nextDate = next.toISOString().slice(0, 10)
  return {
    date,
    timeMin: `${date}T00:00:00${offset}`,
    timeMax: `${nextDate}T00:00:00${offset}`,
  }
}

// --- exchange refresh token for a short-lived access token ---
export async function mintAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  fetchFn: FetchFn = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString()
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await res.json()
  if (!res.ok) {
    if (data?.error === 'invalid_grant') throw new TokenRevokedError()
    throw new Error('token refresh failed: ' + (data?.error || res.status))
  }
  return data.access_token as string
}

// --- read-only Calendar: today's events on the primary calendar ---
export async function fetchTodayEvents(
  accessToken: string,
  tz: string,
  now: Date,
  fetchFn: FetchFn = fetch,
): Promise<{ items?: unknown[] }> {
  const { timeMin, timeMax } = todayBounds(now, tz)
  const qs = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
    timeZone: tz,
  })
  const res = await fetchFn(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (res.status === 401) throw new TokenRevokedError('calendar 401')
  if (!res.ok) throw new Error('calendar fetch ' + res.status)
  return await res.json()
}

// --- read-only Gmail: actionable unread, METADATA HEADERS ONLY ---
const GMAIL_QUERY = 'is:unread in:inbox -category:promotions -category:social -category:updates -category:forums'

function headerVal(payload: any, name: string): string {
  const h = payload?.payload?.headers?.find((x: any) => x.name?.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

// Fetch a wider pool of candidates (the noise filter in buildEmailTasks drops
// newsletters/no-reply, so we over-fetch to still land ~6 real ones). We pull
// the List-Unsubscribe header — its mere presence flags bulk mail — but only as
// a signal; it's never stored in the feed.
export async function fetchActionableUnread(
  accessToken: string,
  fetchFn: FetchFn = fetch,
): Promise<{ messages: { threadId: string; subject: string; from: string; listUnsubscribe: string }[] }> {
  const headers = { Authorization: `Bearer ${accessToken}` }
  const listQs = new URLSearchParams({ q: GMAIL_QUERY, maxResults: '20' })
  const listRes = await fetchFn(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${listQs}`, { headers })
  if (listRes.status === 401) throw new TokenRevokedError('gmail 401')
  if (!listRes.ok) throw new Error('gmail list ' + listRes.status)
  const list = await listRes.json()
  const ids: { id: string }[] = list?.messages ?? []

  const out: { threadId: string; subject: string; from: string; listUnsubscribe: string }[] = []
  for (const { id } of ids.slice(0, 20)) {
    const detQs = new URLSearchParams({ format: 'metadata' })
    detQs.append('metadataHeaders', 'Subject')
    detQs.append('metadataHeaders', 'From')
    detQs.append('metadataHeaders', 'List-Unsubscribe')
    const detRes = await fetchFn(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?${detQs}`, { headers })
    if (!detRes.ok) continue
    const det = await detRes.json()
    out.push({
      threadId: det.threadId,
      subject: headerVal(det, 'Subject'),
      from: headerVal(det, 'From'),
      listUnsubscribe: headerVal(det, 'List-Unsubscribe'),
    })
  }
  return { messages: out }
}
