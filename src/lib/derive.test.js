// Unit tests for the pure derivation layer.
// Run with: node --test src/lib/derive.test.js
//
// Scope note: formatSchedule / fmtDur / accentFor are intentionally NOT tested
// (they are mid-refactor). These tests pin the CURRENT behavior of the stable
// date/bucket/merge helpers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bucketFor, dueLabel, mergeTasks, isoDateStr, addDays } from './derive.js'

// Fixed "now" values (local time). 2026-07-22 is a Wednesday.
const WED = new Date(2026, 6, 22, 10, 30) // Wed Jul 22 2026, 10:30 local

// ---------- isoDateStr / addDays ----------

test('isoDateStr formats local Y-M-D with zero padding', () => {
  assert.equal(isoDateStr(new Date(2026, 0, 5)), '2026-01-05')
  assert.equal(isoDateStr(new Date(2026, 11, 31)), '2026-12-31')
})

test('addDays crosses a month boundary', () => {
  assert.equal(isoDateStr(addDays(new Date(2026, 0, 31), 1)), '2026-02-01')
  assert.equal(isoDateStr(addDays(new Date(2026, 6, 1), -1)), '2026-06-30')
})

test('addDays crosses a year boundary', () => {
  assert.equal(isoDateStr(addDays(new Date(2026, 11, 31), 1)), '2027-01-01')
})

test('addDays stays calendar-correct across DST-ish spring/fall dates', () => {
  // US spring-forward (Mar 8 2026) and fall-back (Nov 1 2026) windows —
  // setDate() is calendar arithmetic, so these hold in any timezone.
  assert.equal(isoDateStr(addDays(new Date(2026, 2, 7), 1)), '2026-03-08')
  assert.equal(isoDateStr(addDays(new Date(2026, 2, 8), 1)), '2026-03-09')
  assert.equal(isoDateStr(addDays(new Date(2026, 9, 31), 1)), '2026-11-01')
  assert.equal(isoDateStr(addDays(new Date(2026, 10, 1), 1)), '2026-11-02')
})

test('addDays does not mutate its input', () => {
  const d = new Date(2026, 6, 22)
  addDays(d, 5)
  assert.equal(isoDateStr(d), '2026-07-22')
})

// ---------- dueLabel ----------

test('dueLabel: empty input -> empty string', () => {
  assert.equal(dueLabel(null, WED), '')
  assert.equal(dueLabel('', WED), '')
})

test('dueLabel: same day -> "today"', () => {
  assert.equal(dueLabel('2026-07-22', WED), 'today')
})

test('dueLabel: next day -> "tomorrow"', () => {
  assert.equal(dueLabel('2026-07-23', WED), 'tomorrow')
})

test('dueLabel: 2-6 days out -> short weekday', () => {
  assert.equal(dueLabel('2026-07-24', WED), 'Fri') // +2
  assert.equal(dueLabel('2026-07-28', WED), 'Tue') // +6
})

test('dueLabel: 7+ days out -> "Mon D" date', () => {
  assert.equal(dueLabel('2026-07-29', WED), 'Jul 29') // +7
  assert.equal(dueLabel('2026-09-01', WED), 'Sep 1')
})

test('dueLabel: past dates fall through to the "Mon D" date form', () => {
  assert.equal(dueLabel('2026-07-20', WED), 'Jul 20')
})

test('dueLabel: unparseable dueDate is returned as-is', () => {
  assert.equal(dueLabel('not-a-date', WED), 'not-a-date')
})

// ---------- bucketFor ----------

test('bucketFor: done wins over everything', () => {
  assert.equal(bucketFor({ done: true, dueDate: '2026-07-01', urgent: true }, WED), 'done')
  assert.equal(bucketFor({ done: true }, WED), 'done')
})

test('bucketFor: real dueDate -> overdue / today / week', () => {
  assert.equal(bucketFor({ dueDate: '2026-07-21' }, WED), 'overdue')
  assert.equal(bucketFor({ dueDate: '2026-07-22' }, WED), 'today')
  assert.equal(bucketFor({ dueDate: '2026-07-23' }, WED), 'week')
  assert.equal(bucketFor({ dueDate: '2026-08-15' }, WED), 'week')
})

test('bucketFor: midnight rollover — same task, before vs after midnight', () => {
  const task = { dueDate: '2026-07-22' }
  const lateTonight = new Date(2026, 6, 22, 23, 59)
  const justPastMidnight = new Date(2026, 6, 23, 0, 0)
  assert.equal(bucketFor(task, lateTonight), 'today')
  assert.equal(bucketFor(task, justPastMidnight), 'overdue')

  const tomorrowTask = { dueDate: '2026-07-23' }
  assert.equal(bucketFor(tomorrowTask, lateTonight), 'week')
  assert.equal(bucketFor(tomorrowTask, justPastMidnight), 'today')
})

test('bucketFor: legacy bucket used only when there is no dueDate', () => {
  assert.equal(bucketFor({ bucket: 'week' }, WED), 'week')
  assert.equal(bucketFor({ bucket: 'overdue' }, WED), 'overdue')
  // dueDate wins over a stale legacy bucket
  assert.equal(bucketFor({ bucket: 'week', dueDate: '2026-07-22' }, WED), 'today')
})

test('bucketFor: unknown bucket or no info clamps to "today"', () => {
  assert.equal(bucketFor({ bucket: 'tomorrow' }, WED), 'today') // feed value, not a real column
  assert.equal(bucketFor({}, WED), 'today')
})

// ---------- mergeTasks ----------

const openA = { id: 'a', title: 'A' }
const openB = { id: 'b', title: 'B' }
const urgentC = { id: 'c', title: 'C', urgent: true }

test('mergeTasks: applies doneById and sorts done tasks last', () => {
  const out = mergeTasks([openA, urgentC], [openB], { a: true })
  assert.deepEqual(out.map((t) => t.id), ['c', 'b', 'a'])
  assert.equal(out.find((t) => t.id === 'a').done, true)
  assert.equal(out.find((t) => t.id === 'b').done, false)
})

test('mergeTasks: urgent floats above non-urgent open tasks', () => {
  const out = mergeTasks([openA], [openB, urgentC], {})
  assert.deepEqual(out.map((t) => t.id), ['c', 'a', 'b'])
})

test('mergeTasks: explicit order beats urgency when both tasks carry one', () => {
  const normalFirst = { id: 'n', order: 1 }
  const urgentSecond = { id: 'u', order: 2, urgent: true }
  const out = mergeTasks([], [urgentSecond, normalFirst], {})
  assert.deepEqual(out.map((t) => t.id), ['n', 'u'])
})

test('mergeTasks: stable tiebreak preserves input order (auto before manual)', () => {
  const out = mergeTasks([{ id: 'a1' }, { id: 'a2' }], [{ id: 'm1' }, { id: 'm2' }], {})
  assert.deepEqual(out.map((t) => t.id), ['a1', 'a2', 'm1', 'm2'])
})

test('mergeTasks: done tasks keep their relative input order', () => {
  const out = mergeTasks([{ id: 'a1' }, { id: 'a2' }], [{ id: 'm1' }], { a1: true, m1: true })
  assert.deepEqual(out.map((t) => t.id), ['a2', 'a1', 'm1'])
})

test('mergeTasks: urgency is ignored among done tasks', () => {
  const out = mergeTasks([{ id: 'd1' }, { id: 'd2', urgent: true }], [], { d1: true, d2: true })
  assert.deepEqual(out.map((t) => t.id), ['d1', 'd2'])
})

test('mergeTasks: does not mutate its inputs', () => {
  const auto = [{ id: 'x' }]
  mergeTasks(auto, [], { x: true })
  assert.equal(auto[0].done, undefined)
})
