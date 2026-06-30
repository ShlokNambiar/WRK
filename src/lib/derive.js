// Pure derivation layer: turns calendar Events (+ tasks) into the view models
// the UI renders. No React, no I/O — trivially testable.
import { C } from '../theme.js'

// ---------- time formatting ----------
export function fmtTime(d) {
  let h = d.getHours() % 12
  if (h === 0) h = 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtDur(min) {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const r = min % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

// ---------- schedule (Today section) ----------
const PREP_RE = /review|presentation|interview|demo|pitch|deck|quarterly|board|client/i
// Recurring lightweight meetings that never warrant a "prep" task.
const ROUTINE_RE = /standup|stand-up|sync|daily|scrum|1:1|1-1|check-?in/i

function accentFor(ev) {
  const t = ev.title.toLowerCase()
  if (/standup|sync|daily|scrum/.test(t)) return C.green
  if (/quarterly|client|acme|board/.test(t)) return C.amber
  return C.blue
}

export function formatSchedule(events) {
  return events.map((ev) => {
    const people = ev.attendeeCount
    const where = ev.videoLabel || ev.location || null
    const meta = [people ? `${people} people` : null, where].filter(Boolean).join(' · ')
    return {
      id: ev.id,
      time: fmtTime(ev.start),
      dur: fmtDur(ev.durationMin),
      accent: accentFor(ev),
      title: ev.title,
      meta,
      badge: ev.movedFrom ? `Moved from ${ev.movedFrom}` : null,
    }
  })
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
    return {
      id: ev.id,
      time: fmtTime(ev.start),
      ampm: h >= 12 ? 'PM' : 'AM',
      accent: accentFor(ev),
      title: ev.title,
      durLabel: fmtDur(ev.durationMin),
      avatars: shown,
      overflow,
      joinUrl: ev.isVideo ? ev.joinUrl || '#' : null,
      location: !ev.isVideo ? ev.location : null,
      highlighted,
      movedBadge: ev.movedFrom ? `Moved from ${ev.movedFrom}` : null,
      isPast: ev.end < now,
    }
  })
}

// ---------- task grouping (All Tasks screen) ----------
// Buckets: overdue / today / week / done. Providers may set t.bucket; otherwise
// we infer a sensible default.
export function bucketFor(t) {
  if (t.done) return 'done'
  if (t.bucket) return t.bucket
  if (t.urgent) return 'today'
  return 'today'
}
export function groupTasks(tasks) {
  const g = { overdue: [], today: [], week: [], done: [] }
  for (const t of tasks) g[bucketFor(t)].push(t)
  return g
}

// ---------- merge auto + manual tasks ----------
export function mergeTasks(autoTasks, manualTasks, doneById) {
  const all = [...autoTasks, ...manualTasks].map((t) => ({ ...t, done: !!doneById[t.id] }))
  // open before done; within open, urgent first; otherwise stable
  return all
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      if (!!a.t.done !== !!b.t.done) return a.t.done ? 1 : -1
      if (!a.t.done && !!a.t.urgent !== !!b.t.urgent) return a.t.urgent ? -1 : 1
      // explicit manual order wins as a tiebreaker, else stable insertion order
      if (a.t.order != null && b.t.order != null) return a.t.order - b.t.order
      return a.i - b.i
    })
    .map(({ t }) => t)
}
