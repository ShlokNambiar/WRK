import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEvents, buildEmailTasks, templateBrief, assemblePayload, computeStats, groupEventsByDay, applyMovedFrom, dayKeyInTz, usersDueNow, rateLimitRetryAfter, safeTz, DEFAULT_TZ, emailTasksAllowed } from './buildPayload.ts'

// ---- buildEvents: Google Calendar events.list -> FeedEvent[] ----
test('buildEvents maps a timed event with all fields', () => {
  const raw = {
    items: [{
      id: 'evt1',
      summary: 'Design review',
      location: 'Room 3B',
      description: 'agenda',
      hangoutLink: 'https://meet.google.com/abc',
      start: { dateTime: '2026-07-01T11:00:00+05:30' },
      end: { dateTime: '2026-07-01T11:45:00+05:30' },
      attendees: [{ email: 'you@x.com', displayName: 'You Yourself', self: true, responseStatus: 'accepted' }],
    }],
  }
  const evs = buildEvents(raw)
  assert.equal(evs.length, 1)
  assert.deepEqual(evs[0], {
    id: 'evt1',
    title: 'Design review',
    start: '2026-07-01T11:00:00+05:30',
    end: '2026-07-01T11:45:00+05:30',
    allDay: false,
    location: 'Room 3B',
    joinUrl: 'https://meet.google.com/abc',
    description: 'agenda',
    movedFrom: null,
    kind: 'meeting', // has a join link
    attendees: [{ email: 'you@x.com', name: 'You Yourself', self: true, organizer: false, responseStatus: 'accepted' }],
  })
})

test('buildEvents keeps location even when the event has a joinUrl', () => {
  const raw = { items: [{
    id: 'hy', summary: 'Hybrid standup', location: 'Room 4A',
    hangoutLink: 'https://meet.google.com/hy',
    start: { dateTime: '2026-07-01T09:00:00+05:30' }, end: { dateTime: '2026-07-01T09:15:00+05:30' },
  }] }
  const ev = buildEvents(raw)[0]
  assert.equal(ev.joinUrl, 'https://meet.google.com/hy')
  assert.equal(ev.location, 'Room 4A') // physical room survives alongside the link
})

test('buildEvents attendee name is null when Google sends no displayName', () => {
  const raw = { items: [{
    id: 'n', summary: 'Sync',
    start: { dateTime: '2026-07-01T10:00:00Z' }, end: { dateTime: '2026-07-01T10:30:00Z' },
    attendees: [{ email: 'priya@x.com' }],
  }] }
  assert.deepEqual(buildEvents(raw)[0].attendees[0], {
    email: 'priya@x.com', name: null, self: false, organizer: false, responseStatus: null,
  })
})

// ---- allDay flag: date-only start, raw date strings kept ----
test('buildEvents sets allDay=true for date-only events and keeps the raw dates', () => {
  const raw = { items: [{ id: 'a', summary: 'Pay rent', start: { date: '2026-07-01' }, end: { date: '2026-07-02' } }] }
  const ev = buildEvents(raw)[0]
  assert.equal(ev.allDay, true)
  assert.equal(ev.start, '2026-07-01') // raw date string, no fake midnight time
  assert.equal(ev.end, '2026-07-02')
})

test('buildEvents sets allDay=false for timed events', () => {
  const raw = { items: [{ id: 't', summary: 'Call', start: { dateTime: '2026-07-01T10:00:00Z' }, end: { dateTime: '2026-07-01T10:30:00Z' } }] }
  assert.equal(buildEvents(raw)[0].allDay, false)
})

// ---- buildEvents: meeting vs reminder classification ----
test('buildEvents marks an event with other attendees as a meeting', () => {
  const raw = { items: [{
    id: 'm', summary: 'Sync with Priya',
    start: { dateTime: '2026-07-01T10:00:00Z' }, end: { dateTime: '2026-07-01T10:30:00Z' },
    attendees: [{ email: 'you@x.com', self: true }, { email: 'priya@x.com' }],
  }] }
  assert.equal(buildEvents(raw)[0].kind, 'meeting')
})

test('buildEvents marks a video-link event with no other attendees as a meeting', () => {
  const raw = { items: [{
    id: 'v', summary: 'Client call',
    start: { dateTime: '2026-07-01T10:00:00Z' }, end: { dateTime: '2026-07-01T10:30:00Z' },
    hangoutLink: 'https://meet.google.com/z',
  }] }
  assert.equal(buildEvents(raw)[0].kind, 'meeting')
})

test('buildEvents marks an all-day event as a reminder', () => {
  const raw = { items: [{ id: 'a', summary: 'Pay rent', start: { date: '2026-07-01' }, end: { date: '2026-07-02' } }] }
  assert.equal(buildEvents(raw)[0].kind, 'reminder')
})

test('buildEvents marks a solo timed block as a reminder', () => {
  const raw = { items: [{
    id: 's', summary: 'Focus: write spec',
    start: { dateTime: '2026-07-01T14:00:00Z' }, end: { dateTime: '2026-07-01T15:00:00Z' },
    attendees: [{ email: 'you@x.com', self: true }],
  }] }
  assert.equal(buildEvents(raw)[0].kind, 'reminder')
})

test('buildEvents marks focusTime / outOfOffice eventType as a reminder even with a join link', () => {
  const raw = { items: [{
    id: 'f', summary: 'Focus time', eventType: 'focusTime',
    start: { dateTime: '2026-07-01T14:00:00Z' }, end: { dateTime: '2026-07-01T16:00:00Z' },
    hangoutLink: 'https://meet.google.com/should-not-count',
  }] }
  assert.equal(buildEvents(raw)[0].kind, 'reminder')
})

// ---- computeStats: meetings counted by kind, not raw event count ----
test('computeStats counts only meetings, not reminders', () => {
  const events = [
    { kind: 'meeting' }, { kind: 'meeting' }, { kind: 'reminder' }, { kind: 'reminder' },
  ]
  const emailTasks = [{ urgent: true }, {}]
  assert.deepEqual(computeStats(events, emailTasks), [
    { n: '2', label: 'meetings' },
    { n: '2', label: 'to do' },
    { n: '1', label: 'flagged' },
  ])
})

test('buildEvents handles empty + all-day, skips cancelled', () => {
  assert.deepEqual(buildEvents({ items: [] }), [])
  assert.deepEqual(buildEvents({}), [])
  const raw = {
    items: [
      { id: 'a', status: 'cancelled', summary: 'x', start: { dateTime: '2026-07-01T10:00:00Z' }, end: { dateTime: '2026-07-01T11:00:00Z' } },
      { id: 'b', summary: 'All day', start: { date: '2026-07-01' }, end: { date: '2026-07-02' } },
    ],
  }
  const evs = buildEvents(raw)
  assert.equal(evs.length, 1)
  assert.equal(evs[0].id, 'b')
  assert.equal(evs[0].start, '2026-07-01')
})

test('buildEvents derives joinUrl from conferenceData when no hangoutLink', () => {
  const raw = { items: [{
    id: 'c', summary: 'Call',
    start: { dateTime: '2026-07-01T09:00:00Z' }, end: { dateTime: '2026-07-01T09:30:00Z' },
    conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://zoom.us/j/9' }] },
  }] }
  assert.equal(buildEvents(raw)[0].joinUrl, 'https://zoom.us/j/9')
})

// ---- buildEmailTasks: Gmail metadata -> emailTask[] ----
const gmailRaw = {
  messages: [
    { threadId: 't1', subject: 'Contract review', from: 'Sarah Chen <sarah@x.com>', snippet: 'SECRET_BODY_TEXT please sign', unread: true },
    { threadId: 't2', subject: 'Q3 numbers', from: 'priya@x.com', snippet: 'ANOTHER_SECRET', unread: true },
  ],
}

test('buildEmailTasks maps subject+sender, never the body/snippet', () => {
  const tasks = buildEmailTasks(gmailRaw)
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].id, 'mail:t1')
  assert.equal(tasks[0].source, 'Email')
  assert.equal(tasks[0].bucket, 'today')
  assert.match(tasks[0].title, /Contract review/)
  assert.match(tasks[0].meta, /Sarah Chen/)
  // privacy: snippet/body must never leak into a task
  const blob = JSON.stringify(tasks)
  assert.ok(!blob.includes('SECRET_BODY_TEXT'))
  assert.ok(!blob.includes('ANOTHER_SECRET'))
})

test('buildEmailTasks is a pure mapper and caps at 6 (filtering happens upstream)', () => {
  const many = { messages: Array.from({ length: 12 }, (_, i) => ({ threadId: 't' + i, subject: 's' + i, from: 'a@b.com' })) }
  assert.equal(buildEmailTasks(many).length, 6)
})

// ---- urgent flag: deterministic subject-line cues feed the "flagged" stat ----
test('buildEmailTasks flags urgent subjects', () => {
  const hits = [
    'URGENT: server down',
    'Please review ASAP',
    'Action required: verify your account',
    'Deadline moved to Friday',
    'Need this by EOD',
    'Send the deck by tomorrow',
    'Invoice overdue',
    'Final notice from finance',
  ]
  const tasks = buildEmailTasks({ messages: hits.map((subject, i) => ({ threadId: 't' + i, subject, from: 'a@b.com' })) })
  for (const t of tasks.slice(0, 6)) assert.equal(t.urgent, true, t.title)
})

test('buildEmailTasks does not flag ordinary subjects', () => {
  const misses = [
    'Lunch plans?',
    'Q3 numbers',
    'Weekly digest',
    'Working urgently on the fix', // "urgently" is not a \burgent\b match
  ]
  const tasks = buildEmailTasks({ messages: misses.map((subject, i) => ({ threadId: 't' + i, subject, from: 'a@b.com' })) })
  for (const t of tasks) assert.equal(t.urgent, false, t.title)
})

test('urgent tasks flow into the flagged stat', () => {
  const tasks = buildEmailTasks({ messages: [
    { threadId: 't1', subject: 'URGENT: sign this', from: 'a@b.com' },
    { threadId: 't2', subject: 'Lunch?', from: 'a@b.com' },
  ] })
  assert.deepEqual(computeStats([], tasks)[2], { n: '1', label: 'flagged' })
})

// ---- templateBrief: deterministic, no AI ----
test('templateBrief builds 3 stats: meetings / to do / flagged (meetings by kind)', () => {
  const events = [{ id: '1', kind: 'meeting' }, { id: '2', kind: 'meeting' }, { id: '3', kind: 'reminder' }]
  const emailTasks = [{ id: 'a', urgent: true }, { id: 'b' }]
  const brief = templateBrief(events, emailTasks)
  assert.deepEqual(brief.stats, [
    { n: '2', label: 'meetings' }, // the reminder is not a meeting
    { n: '2', label: 'to do' },
    { n: '1', label: 'flagged' },
  ])
  assert.ok(Array.isArray(brief.runs) && brief.runs.length >= 1)
  assert.equal(typeof brief.text, 'string')
})

test('templateBrief handles an empty day', () => {
  const brief = templateBrief([], [])
  assert.deepEqual(brief.stats, [
    { n: '0', label: 'meetings' },
    { n: '0', label: 'to do' },
    { n: '0', label: 'flagged' },
  ])
})

// ---- groupEventsByDay: the 7-day map keyed by LOCAL date ----
const IST = 'Asia/Kolkata'
const NOW = new Date('2026-07-01T01:00:00Z') // 06:30 IST on 2026-07-01

test('groupEventsByDay always emits all 7 keys, empty array = free day', () => {
  const days = groupEventsByDay([], NOW, IST)
  assert.deepEqual(Object.keys(days), [
    '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07',
  ])
  for (const k of Object.keys(days)) assert.deepEqual(days[k], [])
})

test('groupEventsByDay keys by the LOCAL date of the start, not the UTC date', () => {
  // 20:30Z on Jul 1 is already 02:00 IST on Jul 2
  const events = buildEvents({ items: [
    { id: 'utc', summary: 'Late call', start: { dateTime: '2026-07-01T20:30:00Z' }, end: { dateTime: '2026-07-01T21:00:00Z' } },
  ] })
  const days = groupEventsByDay(events, NOW, IST)
  assert.deepEqual(days['2026-07-01'], [])
  assert.equal(days['2026-07-02'].length, 1)
  assert.equal(days['2026-07-02'][0].id, 'utc')
})

test('groupEventsByDay puts a multi-day all-day event under its start date only', () => {
  const events = buildEvents({ items: [
    { id: 'trip', summary: 'Offsite', start: { date: '2026-07-03' }, end: { date: '2026-07-06' } },
  ] })
  const days = groupEventsByDay(events, NOW, IST)
  assert.equal(days['2026-07-03'].length, 1)
  assert.deepEqual(days['2026-07-04'], []) // never duplicated onto later days
  assert.deepEqual(days['2026-07-05'], [])
})

test('groupEventsByDay shows an event that started before today under today', () => {
  const events = buildEvents({ items: [
    { id: 'vac', summary: 'Vacation', start: { date: '2026-06-29' }, end: { date: '2026-07-03' } },
  ] })
  const days = groupEventsByDay(events, NOW, IST)
  assert.equal(days['2026-07-01'][0].id, 'vac') // ongoing block doesn't vanish
})

test('groupEventsByDay keeps each day sorted by start', () => {
  const events = buildEvents({ items: [
    { id: 'b', summary: 'Later', start: { dateTime: '2026-07-02T15:00:00+05:30' }, end: { dateTime: '2026-07-02T16:00:00+05:30' } },
    { id: 'a', summary: 'Earlier', start: { dateTime: '2026-07-02T09:00:00+05:30' }, end: { dateTime: '2026-07-02T10:00:00+05:30' } },
  ] })
  const days = groupEventsByDay(events, NOW, IST)
  assert.deepEqual(days['2026-07-02'].map((e) => e.id), ['a', 'b'])
})

test('dayKeyInTz gives the local YYYY-MM-DD', () => {
  assert.equal(dayKeyInTz(NOW, IST), '2026-07-01')
  assert.equal(dayKeyInTz(new Date('2026-07-01T20:00:00Z'), IST), '2026-07-02')
})

// ---- stats describe TODAY only, even though the payload holds a week ----
test('computeStats over the today slice ignores the rest of the week', () => {
  const events = buildEvents({ items: [
    { id: 'today', summary: 'Today mtg', hangoutLink: 'https://meet.google.com/1',
      start: { dateTime: '2026-07-01T10:00:00+05:30' }, end: { dateTime: '2026-07-01T10:30:00+05:30' } },
    { id: 'later', summary: 'Thursday mtg', hangoutLink: 'https://meet.google.com/2',
      start: { dateTime: '2026-07-02T10:00:00+05:30' }, end: { dateTime: '2026-07-02T10:30:00+05:30' } },
  ] })
  const days = groupEventsByDay(events, NOW, IST)
  const stats = computeStats(days[dayKeyInTz(NOW, IST)], [])
  assert.deepEqual(stats[0], { n: '1', label: 'meetings' }) // not 2
})

// ---- applyMovedFrom: diff against the previous feed's days ----
function payloadWith(days: Record<string, any[]>) {
  return { generatedAt: '', profile: { name: '', email: '', avatarUrl: null }, brief: null, days, emailTasks: [] } as any
}
const mkEvent = (id: string, start: string, allDay = false) => ({
  id, title: id, start, end: start, allDay, location: null, joinUrl: null,
  description: null, movedFrom: null, kind: 'meeting' as const, attendees: [],
})

test('applyMovedFrom sets the old local time when a timed event moved', () => {
  const oldPayload = payloadWith({ '2026-07-01': [mkEvent('e1', '2026-07-01T15:00:00+05:30')] })
  const [ev] = applyMovedFrom([mkEvent('e1', '2026-07-01T17:30:00+05:30')], oldPayload, IST)
  assert.equal(ev.movedFrom, '3:00 PM')
})

test('applyMovedFrom finds the old event under ANY previous day (cross-day move)', () => {
  const oldPayload = payloadWith({ '2026-07-01': [], '2026-07-02': [mkEvent('e1', '2026-07-02T09:00:00+05:30')] })
  const [ev] = applyMovedFrom([mkEvent('e1', '2026-07-01T11:00:00+05:30')], oldPayload, IST)
  assert.equal(ev.movedFrom, '9:00 AM')
})

test('applyMovedFrom leaves an unmoved event alone', () => {
  const oldPayload = payloadWith({ '2026-07-01': [mkEvent('e1', '2026-07-01T15:00:00+05:30')] })
  const [ev] = applyMovedFrom([mkEvent('e1', '2026-07-01T15:00:00+05:30')], oldPayload, IST)
  assert.equal(ev.movedFrom, null)
})

test('applyMovedFrom leaves a brand-new event alone', () => {
  const oldPayload = payloadWith({ '2026-07-01': [mkEvent('other', '2026-07-01T15:00:00+05:30')] })
  const [ev] = applyMovedFrom([mkEvent('e1', '2026-07-01T17:00:00+05:30')], oldPayload, IST)
  assert.equal(ev.movedFrom, null)
})

test('applyMovedFrom never marks all-day events (no clock time to move from)', () => {
  const oldPayload = payloadWith({ '2026-07-01': [mkEvent('e1', '2026-07-01', true)] })
  const [ev] = applyMovedFrom([mkEvent('e1', '2026-07-03', true)], oldPayload, IST)
  assert.equal(ev.movedFrom, null)
})

test('applyMovedFrom handles a missing previous payload', () => {
  const [ev] = applyMovedFrom([mkEvent('e1', '2026-07-01T17:00:00+05:30')], null, IST)
  assert.equal(ev.movedFrom, null)
})

// ---- usersDueNow: hourly cron picks users whose local hour == brief_hour ----
test('usersDueNow matches users by their CURRENT LOCAL hour', () => {
  // 01:30 UTC = 07:00 IST (+05:30) on Jul 1 and 21:30 EDT (-04:00) on Jun 30
  const at = new Date('2026-07-01T01:30:00Z')
  const users = [
    { user_id: 'a', tz: 'Asia/Kolkata', brief_hour: 7 },      // 07:00 IST -> due
    { user_id: 'b', tz: 'Asia/Kolkata', brief_hour: 8 },      // 07:00 IST -> not due
    { user_id: 'c', tz: 'America/New_York', brief_hour: 21 }, // 21:30 EDT -> due
    { user_id: 'd', tz: 'America/New_York', brief_hour: 7 },  // 21:30 EDT -> not due
  ]
  assert.deepEqual(usersDueNow(users, at).map((u) => u.user_id), ['a', 'c'])
})

test('usersDueNow handles midnight (hour 0), not confusing it with 24', () => {
  const at = new Date('2026-07-01T00:30:00Z') // 00:30 UTC
  const users = [{ user_id: 'z', tz: 'UTC', brief_hour: 0 }]
  assert.deepEqual(usersDueNow(users, at).map((u) => u.user_id), ['z'])
})

test('usersDueNow falls back to the app-default tz on a corrupt tz string', () => {
  const at = new Date('2026-07-01T01:30:00Z') // 07:00 IST
  const users = [{ user_id: 'x', tz: 'Not/AZone', brief_hour: 7 }]
  assert.deepEqual(usersDueNow(users, at).map((u) => u.user_id), ['x'])
})

// ---- safeTz: garbage profiles.tz must never crash a build ----
test('safeTz passes a valid IANA zone through unchanged', () => {
  assert.equal(safeTz('Asia/Kolkata'), 'Asia/Kolkata')
  assert.equal(safeTz('America/New_York'), 'America/New_York')
  assert.equal(safeTz('UTC'), 'UTC')
})

test('safeTz falls back to the app default on garbage', () => {
  assert.equal(DEFAULT_TZ, 'Asia/Kolkata')
  assert.equal(safeTz('Not/AZone'), DEFAULT_TZ)
  assert.equal(safeTz(''), DEFAULT_TZ)
  assert.equal(safeTz('<script>alert(1)</script>'), DEFAULT_TZ)
})

// ---- emailTasksAllowed: tier gate + the user's email-tasks switch ----
test('emailTasksAllowed: pro with the switch on (or unset) gets the email pipeline', () => {
  assert.equal(emailTasksAllowed({ tier: 'pro', email_tasks_enabled: true }), true)
  assert.equal(emailTasksAllowed({ tier: 'pro' }), true) // column default is true
})

test('emailTasksAllowed: free tier or switch off skips the email pipeline', () => {
  assert.equal(emailTasksAllowed({ tier: 'free', email_tasks_enabled: true }), false)
  assert.equal(emailTasksAllowed({ tier: 'pro', email_tasks_enabled: false }), false)
})

// ---- rateLimitRetryAfter: one user-invoked rebuild per 10 minutes, keyed on
// feeds.last_rebuild_at (stamped BEFORE any outbound work, so error paths
// can't retry without limit) ----
test('rateLimitRetryAfter allows when there is no previous rebuild stamp', () => {
  assert.equal(rateLimitRetryAfter(null, new Date('2026-07-01T10:00:00Z')), 0)
})

test('rateLimitRetryAfter blocks inside the window with seconds remaining', () => {
  const now = new Date('2026-07-01T10:09:00Z') // 9 min after the last stamp
  assert.equal(rateLimitRetryAfter('2026-07-01T10:00:00Z', now), 60)
})

test('rateLimitRetryAfter boundary: exactly 10 minutes later is allowed', () => {
  const now = new Date('2026-07-01T10:10:00.000Z')
  assert.equal(rateLimitRetryAfter('2026-07-01T10:00:00Z', now), 0)
  // 1ms before the boundary is still blocked (rounds up to a whole second)
  assert.equal(rateLimitRetryAfter('2026-07-01T10:00:00Z', new Date('2026-07-01T10:09:59.999Z')), 1)
})

// ---- assemblePayload: the final feed; raw content must never appear ----
test('assemblePayload produces the documented multi-day shape', () => {
  const events = buildEvents({ items: [{ id: 'e', summary: 'M', start: { dateTime: '2026-07-01T10:00:00+05:30' }, end: { dateTime: '2026-07-01T10:30:00+05:30' } }] })
  const emailTasks = buildEmailTasks(gmailRaw)
  const days = groupEventsByDay(events, NOW, IST)
  const brief = templateBrief(days['2026-07-01'], emailTasks)
  const payload = assemblePayload({
    profile: { name: 'Shlok', email: 's@x.com', avatarUrl: null },
    brief, days, emailTasks, now: NOW,
  })
  assert.equal(payload.profile.name, 'Shlok')
  assert.equal(Object.keys(payload.days).length, 7)
  assert.equal(payload.days['2026-07-01'].length, 1)
  assert.deepEqual(payload.days['2026-07-02'], [])
  assert.equal(payload.generatedAt, '2026-07-01T01:00:00.000Z')
  assert.ok(payload.brief)
  // privacy invariant: no raw email body anywhere in the stored feed
  const blob = JSON.stringify(payload)
  assert.ok(!blob.includes('SECRET_BODY_TEXT'), 'raw email body leaked into feed')
  assert.ok(!blob.includes('ANOTHER_SECRET'), 'raw email body leaked into feed')
})
