import { test } from 'node:test'
import assert from 'node:assert/strict'
import { userContent } from './briefShared.ts'

const meeting = { id: 'm', title: 'Sync with Priya', start: '2026-07-01T10:00:00+05:30', kind: 'meeting' } as any
const reminder = { id: 'r', title: 'Pay rent', start: '2026-07-01T00:00:00+05:30', kind: 'reminder' } as any

test('userContent lists meetings and reminders separately and counts only meetings', () => {
  const out = userContent([meeting, reminder], [])
  // the meeting appears under meetings, the reminder under reminders
  assert.match(out, /Today's meetings:\n- Sync with Priya/)
  assert.match(out, /Reminders[^\n]*\n- Pay rent/)
  // the count line reports 1 meeting, not 2 events
  assert.match(out, /meetings: 1\b/)
})

test('userContent shows (none) when there are no meetings', () => {
  const out = userContent([reminder], [])
  assert.match(out, /Today's meetings:\n\(none\)/)
  assert.match(out, /meetings: 0\b/)
})
