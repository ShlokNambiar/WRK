// Pure derivation layer: turns calendar Events (+ tasks) into the view models
// the UI renders. No React, no I/O — trivially testable.
import { C } from '../theme.js'

// ---------- time formatting ----------
export function fmtTime(d) {
  let h = d.getHours() % 12
  if (h === 0) h = 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---------- schedule (Today section) ----------
const PREP_RE = /review|presentation|interview|demo|pitch|deck|quarterly|board|client/i
// Recurring lightweight meetings that never warrant a "prep" task.
const ROUTINE_RE = /standup|stand-up|sync|daily|scrum|1:1|1-1|check-?in/i

function accentFor(ev) {
  const t = ev.title.toLowerCase()
  if (/standup|sync|daily|scrum/.test(t)) return C.green
  if (/quarterly|client|board/.test(t)) return C.amber
  return C.blue
}

// ---------- auto-tasks derived from the calendar ----------
// Stable ids (auto:<eventId>:<type>) so a task survives a daily refresh and its
// done-state persists, without ever duplicating.
export function deriveAutoTasks(events, now = new Date()) {
  const out = []
  for (const ev of events) {
    const startsSoon = ev.start - now < 3 * 3600_000 && ev.start > now

    // 1. Unanswered invite -> RSVP
    if (ev.myResponse === 'needsAction') {
      out.push({
        id: `auto:${ev.id}:rsvp`,
        title: `Respond to “${ev.title}” invite`,
        source: 'Calendar', meta: `${fmtTime(ev.start)} · awaiting your reply`,
        due: 'today', urgent: true, auto: true,
      })
    }

    // 2. Prep for substantive meetings (never for routine recurring ones)
    if (!ROUTINE_RE.test(ev.title) && (PREP_RE.test(ev.title) || ev.attendeeCount >= 5)) {
      out.push({
        id: `auto:${ev.id}:prep`,
        title: `Prep for ${ev.title}`,
        source: 'Meeting', meta: `${ev.attendeeCount} people · ${fmtTime(ev.start)}`,
        due: `before ${fmtTime(ev.start)}`, urgent: startsSoon, auto: true,
      })
    }

    // 3. A doc linked in the invite -> review it first
    if (ev.docLink) {
      out.push({
        id: `auto:${ev.id}:doc`,
        title: `Review the doc for ${ev.title}`,
        source: 'Meeting', meta: 'linked in the invite',
        due: `before ${fmtTime(ev.start)}`, urgent: false, auto: true,
      })
    }
  }
  return out
}

// ---------- greeting ----------
export function buildGreeting(now, name) {
  const h = now.getHours()
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now)
  const month = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now)
  return {
    dateLabel: `${weekday} · ${month} ${now.getDate()}`,
    greeting: part,
    name: name || 'there',
  }
}

// ---------- the brief ----------
// Returns { runs: [{text, emph?}], stats: [{n,label}] } so the UI can render
// emphasis without parsing strings.
export function buildBrief(events, tasks, now = new Date()) {
  const meetings = events.length
  const open = tasks.filter((t) => !t.done)
  const openCount = open.length
  const moved = events.find((e) => e.movedFrom)
  const needRsvp = events.filter((e) => e.myResponse === 'needsAction').length
  const urgent = open.find((t) => t.urgent)

  const runs = []
  runs.push({ text: `${meetings} meeting${meetings === 1 ? '' : 's'} today` })
  if (moved) {
    runs.push({ text: ' — your ' })
    runs.push({ text: `${moved.title} moved to ${fmtTime(moved.start)}`, emph: true })
    runs.push({ text: '. ' })
  } else {
    runs.push({ text: '. ' })
  }
  if (openCount) {
    runs.push({ text: `${openCount} task${openCount === 1 ? '' : 's'} need your attention` })
    if (urgent) {
      runs.push({ text: ', starting with ' })
      runs.push({ text: `${stripQuotes(urgent.title)} (${urgent.due})`, emph: true })
      runs.push({ text: '.' })
    } else {
      runs.push({ text: '.' })
    }
  } else {
    runs.push({ text: `you're all caught up on tasks.` })
  }

  const third = needRsvp
    ? { n: String(needRsvp), label: 'to RSVP' }
    : { n: String(open.filter((t) => t.urgent).length), label: 'due soon' }

  return {
    runs,
    stats: [
      { n: String(meetings), label: 'meetings' },
      { n: String(openCount), label: 'to do' },
      third,
    ],
  }
}

function stripQuotes(s) {
  return s.replace(/[“”"]/g, '')
}

// ---------- attendee avatars ----------
const AV_GRADS = [
  'radial-gradient(circle at 34% 30%,#bcd4ff,#5b8cff)',
  'radial-gradient(circle at 34% 30%,#ffd28a,#f5a623)',
  'radial-gradient(circle at 34% 30%,#f7a8c4,#e0608f)',
  'radial-gradient(circle at 34% 30%,#b8e6c8,#1f8a5b)',
  'radial-gradient(circle at 34% 30%,#d9c4ff,#7c5cff)',
]
function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}
export function avatarGradient(seed) {
  return AV_GRADS[hash(seed || 'x') % AV_GRADS.length]
}

// ---------- rich timeline (Home + Calendar) ----------
export function buildTimeline(events, now = new Date()) {
  return events.map((ev) => {
    const h = ev.start.getHours()
    const others = (ev.attendeesList || []).filter((a) => !a.self)
    const shown = others.slice(0, 3).map((a) => ({ grad: avatarGradient(a.email) }))
    const overflow = Math.max(0, others.length - shown.length)
    const highlighted = !!ev.movedFrom
    const endsSameHalf = (ev.start.getHours() >= 12) === (ev.end.getHours() >= 12)
    return {
      id: ev.id,
      time: ev.allDay ? 'All' : fmtTime(ev.start),
      ampm: ev.allDay ? 'day' : h >= 12 ? 'PM' : 'AM',
      accent: accentFor(ev),
      title: ev.title,
      allDay: !!ev.allDay,
      // "9:30–10:15 AM" so "when am I free?" needs no arithmetic
      durLabel: ev.allDay ? 'all day'
        : `${fmtTime(ev.start)}${endsSameHalf ? '' : (ev.start.getHours() >= 12 ? ' pm' : ' am')}–${fmtTime(ev.end)} ${ev.end.getHours() >= 12 ? 'pm' : 'am'}`,
      avatars: shown,
      overflow,
      // only a real URL renders a Join button — never a '#' placeholder
      joinUrl: ev.joinUrl && ev.joinUrl !== '#' ? ev.joinUrl : null,
      // a hybrid meeting keeps its room even when there's a video link
      location: ev.location || null,
      highlighted,
      movedBadge: ev.movedFrom ? `Moved from ${ev.movedFrom}` : null,
      isPast: !ev.allDay && ev.end < now,
      // full data for the detail sheet
      raw: ev,
    }
  })
}

// ---------- due dates ----------
// Manual tasks carry a real dueDate ('YYYY-MM-DD' local) so buckets roll over:
// yesterday's "today" task becomes overdue tomorrow instead of lying forever.
export function isoDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// Human label for a dueDate relative to now: 'today' / 'tomorrow' / 'Fri' / 'Jul 12'.
export function dueLabel(dueDate, now = new Date()) {
  if (!dueDate) return ''
  const todayKey = isoDateStr(now)
  if (dueDate === todayKey) return 'today'
  if (dueDate === isoDateStr(addDays(now, 1))) return 'tomorrow'
  const d = new Date(dueDate + 'T00:00:00')
  if (isNaN(d)) return dueDate
  const diff = Math.round((d - new Date(todayKey + 'T00:00:00')) / 864e5)
  if (diff > 1 && diff < 7) return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d)
}

// ---------- task grouping (All Tasks screen) ----------
// Buckets: overdue / today / week / done. A real dueDate wins (and rolls over
// day to day); providers may still set t.bucket (feed email tasks); otherwise
// we infer a sensible default.
const BUCKETS = new Set(['overdue', 'today', 'week', 'done'])
export function bucketFor(t, now = new Date()) {
  if (t.done) return 'done'
  if (t.dueDate) {
    const todayKey = isoDateStr(now)
    if (t.dueDate < todayKey) return 'overdue'
    if (t.dueDate === todayKey) return 'today'
    return 'week'
  }
  // clamp any unknown bucket (a feed emailTask can carry e.g. 'tomorrow') to a
  // real column — otherwise groupTasks would index an undefined array and throw.
  if (t.bucket && BUCKETS.has(t.bucket)) return t.bucket
  return 'today'
}
export function groupTasks(tasks, now = new Date()) {
  const g = { overdue: [], today: [], week: [], done: [] }
  for (const t of tasks) g[bucketFor(t, now)].push(t)
  return g
}

// ---------- live headline stats ----------
// The brief card's numbers, recomputed from CURRENT state (feed stats are baked
// at build time and go stale the moment the user checks something off — the
// tiles must never disagree with the list below them).
export function liveStats(events, tasks) {
  const open = tasks.filter((t) => !t.done)
  // meetings by the same heuristic the backend uses: kind when the feed carries
  // it, else "someone else is on it or there's a link to join".
  const meetings = events.filter((e) =>
    e.kind ? e.kind === 'meeting' : (e.attendeeCount > 0 || e.isVideo)).length
  const flagged = open.filter((t) => t.urgent).length
  return [
    { n: String(meetings), label: 'meetings' },
    { n: String(open.length), label: 'to do' },
    { n: String(flagged), label: 'flagged' },
  ]
}

// ---------- merge auto + manual tasks ----------
export function mergeTasks(autoTasks, manualTasks, doneById) {
  const all = [...autoTasks, ...manualTasks].map((t) => ({ ...t, done: !!doneById[t.id] }))
  // open before done; within open, urgent first; otherwise stable
  return all
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      if (!!a.t.done !== !!b.t.done) return a.t.done ? 1 : -1
      if (!a.t.done) {
        // explicit manual order wins over urgency, so a dragged Normal task can
        // sit above an urgent one without snapping back next render.
        if (a.t.order != null && b.t.order != null) return a.t.order - b.t.order
        if (!!a.t.urgent !== !!b.t.urgent) return a.t.urgent ? -1 : 1
      }
      return a.i - b.i
    })
    .map(({ t }) => t)
}
