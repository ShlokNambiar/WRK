// Normalizes raw Google-Calendar-shaped events (the `items` the feed emits) into
// the internal Event model the rest of the app consumes. The app no longer does
// any on-device Google access — events arrive via the server-built feed — so this
// is a pure transform with no auth/network code.
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
