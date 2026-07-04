// Normalizes raw Google-Calendar-shaped events (the `items` the feed emits) into
// the internal Event model the rest of the app consumes. The app no longer does
// any on-device Google access — events arrive via the server-built feed — so this
// is a pure transform with no auth/network code.
const URL_RE = /(https?:\/\/[^\s)]+)/i

// Raw Google event -> internal Event
export function normalizeEvent(e) {
  // all-day items carry bare dates — parse as LOCAL midnight (new Date('YYYY-MM-DD')
  // would be UTC midnight, which shifted every all-day event to 5:30 AM in IST)
  const allDay = !!(e._allDay || (e.start?.date && !e.start?.dateTime))
  const parse = (v) => (allDay && /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(v + 'T00:00:00') : new Date(v))
  const start = parse(e.start?.dateTime || e.start?.date)
  const end = e.end?.dateTime || e.end?.date ? parse(e.end?.dateTime || e.end?.date) : start
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
    allDay,
    kind: e._kind || null, // 'meeting' | 'reminder' when the feed provides it
    durationMin: Math.max(0, Math.round((end - start) / 60000)),
    attendeeCount: attendees.length,
    attendeesList: attendees.map((a) => ({ email: a.email, name: a.displayName || null, self: !!a.self })),
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
