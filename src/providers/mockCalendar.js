// Mock calendar source. Returns raw events in the SAME shape the Google
// Calendar API returns (events.list `items`), so googleCalendar.js can replace
// this with zero changes downstream. See normalizeEvent() in calendar.js.
//
// Events are generated for "today" relative to `now` so the schedule always
// looks live during development.

function at(now, h, m) {
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

export async function getRawEvents(now = new Date()) {
  // Simulate async network latency
  return [
    {
      id: 'evt_standup',
      summary: 'Daily standup',
      start: { dateTime: at(now, 9, 30) },
      end: { dateTime: at(now, 9, 45) },
      hangoutLink: 'https://zoom.us/j/000',
      attendees: [
        { email: 'you@pepl.life', self: true, responseStatus: 'accepted' },
        { email: 'a@x.co' }, { email: 'b@x.co' }, { email: 'c@x.co' },
        { email: 'd@x.co' }, { email: 'e@x.co' },
      ],
    },
    {
      id: 'evt_design',
      summary: 'Design review',
      description: 'Walk through the new flows. Doc: https://docs.example.com/design-v2',
      location: 'Room 3B',
      start: { dateTime: at(now, 11, 0) },
      end: { dateTime: at(now, 11, 45) },
      attendees: [
        { email: 'you@pepl.life', self: true, responseStatus: 'accepted' },
        { email: 'lead@x.co' }, { email: 'pm@x.co' }, { email: 'eng@x.co' },
      ],
    },
    {
      id: 'evt_acme',
      summary: 'Acme quarterly review',
      location: 'Conference room A',
      start: { dateTime: at(now, 15, 0) },
      end: { dateTime: at(now, 16, 0) },
      _movedFrom: '2:00', // mock-only hint; real provider would diff against a cache
      attendees: [
        { email: 'you@pepl.life', self: true, responseStatus: 'accepted' },
        { email: 'client@acme.com' }, { email: 'vp@acme.com' },
      ],
    },
    {
      id: 'evt_1on1',
      summary: '1:1 with Priya',
      start: { dateTime: at(now, 16, 30) },
      end: { dateTime: at(now, 17, 0) },
      hangoutLink: 'https://meet.google.com/abc',
      attendees: [
        { email: 'you@pepl.life', self: true, responseStatus: 'needsAction' }, // unanswered invite
        { email: 'priya@x.co', organizer: true },
      ],
    },
  ]
}
