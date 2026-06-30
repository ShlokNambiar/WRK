// Real Google Calendar source — drop-in replacement for mockCalendar.js.
// Returns raw events.list `items` (same shape mockCalendar produces), so
// calendar.js normalizes both identically.
//
// NOT wired yet: needs an OAuth access token with the (sensitive, NOT
// restricted) scope:  https://www.googleapis.com/auth/calendar.readonly
//
// Where the token comes from:
//   - Web:    Google Identity Services (GIS) token client in the browser, OR
//   - Native: @capacitor-community/generic-oauth2 / a backend that holds the
//             refresh token and returns a short-lived access token.
// Keep client secrets OFF the device — use PKCE (no secret) or a backend.

import { getAccessToken } from '../lib/googleAuth.js' // implement when wiring auth

const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

export async function getRawEvents(now = new Date()) {
  const token = await getAccessToken() // throws/returns null until auth is built
  if (!token) return []

  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const end = new Date(now); end.setHours(23, 59, 59, 999)

  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  })

  const res = await fetch(`${CAL_BASE}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Calendar API ${res.status}`)
  const data = await res.json()
  return data.items || []
}
