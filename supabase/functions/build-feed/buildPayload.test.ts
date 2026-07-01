import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEvents, buildEmailTasks, templateBrief, assemblePayload, computeStats } from './buildPayload.ts'

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
      attendees: [{ email: 'you@x.com', self: true, responseStatus: 'accepted' }],
    }],
  }
  const evs = buildEvents(raw)
  assert.equal(evs.length, 1)
  assert.deepEqual(evs[0], {
    id: 'evt1',
    title: 'Design review',
    start: '2026-07-01T11:00:00+05:30',
    end: '2026-07-01T11:45:00+05:30',
    location: 'Room 3B',
    joinUrl: 'https://meet.google.com/abc',
    description: 'agenda',
    movedFrom: null,
    kind: 'meeting', // has a join link
    attendees: [{ email: 'you@x.com', self: true, organizer: false, responseStatus: 'accepted' }],
  })
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

// ---- assemblePayload: the final feed; raw content must never appear ----
test('assemblePayload produces the documented shape under today key', () => {
  const events = buildEvents({ items: [{ id: 'e', summary: 'M', start: { dateTime: '2026-07-01T10:00:00Z' }, end: { dateTime: '2026-07-01T10:30:00Z' } }] })
  const emailTasks = buildEmailTasks(gmailRaw)
  const brief = templateBrief(events, emailTasks)
  const payload = assemblePayload({
    profile: { name: 'Shlok', email: 's@x.com', avatarUrl: null },
    brief, events, emailTasks, today: '2026-07-01', now: new Date('2026-07-01T01:00:00Z'),
  })
  assert.equal(payload.profile.name, 'Shlok')
  assert.ok(payload.days['2026-07-01'])
  assert.equal(payload.days['2026-07-01'].length, 1)
  assert.equal(payload.generatedAt, '2026-07-01T01:00:00.000Z')
  assert.ok(payload.brief)
  // privacy invariant: no raw email body anywhere in the stored feed
  const blob = JSON.stringify(payload)
  assert.ok(!blob.includes('SECRET_BODY_TEXT'), 'raw email body leaked into feed')
  assert.ok(!blob.includes('ANOTHER_SECRET'), 'raw email body leaked into feed')
})
