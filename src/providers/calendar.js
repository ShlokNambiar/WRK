// Calendar provider. Normalizes raw Google-Calendar-shaped events into the
// internal Event model the rest of the app consumes. Swap the source by
// changing SOURCE — googleCalendar.js implements the same getRawEvents(now).
import { getRawEvents as getMockEvents } from './mockCalendar.js'
import { getRawEvents as getGoogleEvents } from './googleCalendar.js'
import { getAccessToken, isConnected } from '../lib/googleAuth.js'

const URL_RE = /(https?:\/\/[^\s)]+)/i

// Raw Google event -> internal Event
export function normalizeEvent(e) {
  const start = new Date(e.start?.dateTime || e.start?.date)
  const end = new Date(e.end?.dateTime || e.end?.date || start)
  const attendees = e.attendees || []
  const me = attendees.find((a) => a.self)
  const isVideo = !!(e.hangoutLink || e.conferenceData)
  const docMatch = (e.description || '').match(URL_RE)
  return {
    id: e.id,
    title: e.summary || '(no title)',
    description: e.description || '',
    start,
    end,
    durationMin: Math.max(0, Math.round((end - start) / 60000)),
    attendeeCount: attendees.length,
    attendeesList: attendees.map((a) => ({ email: a.email, self: !!a.self })),
    organizer: attendees.find((a) => a.organizer)?.email || null,
    location: e.location || null,
    isVideo,
    joinUrl: e.hangoutLink || e.conferenceData?.entryPoints?.[0]?.uri || null,
    videoLabel: e.hangoutLink?.includes('zoom') ? 'Zoom' : isVideo ? 'Video' : null,
    myResponse: me?.responseStatus || 'accepted', // accepted | needsAction | declined | tentative
    docLink: docMatch ? docMatch[1] : null,
    movedFrom: e._movedFrom || null,
  }
}

export async function getTodayEvents(now = new Date()) {
  // Real Google data when connected; mock only when never connected. When a
  // connection exists but the token is momentarily unavailable (expired refresh),
  // return empty rather than fake data the user might mistake for real.
  const token = await getAccessToken()
  const raw = token ? await getGoogleEvents(now) : isConnected() ? [] : await getMockEvents(now)
  return raw
    .map(normalizeEvent)
    .sort((a, b) => a.start - b.start)
}
