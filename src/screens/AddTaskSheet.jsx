import { useMemo, useState } from 'react'
import Pressable from '../components/Pressable.jsx'
import { C, FONT_SERIF, FONT_SANS } from '../theme.js'

// Inner content of the Add/Edit-task bottom sheet. Wrapped by <Sheet> in WrkApp.
export default function AddTaskSheet({ day, editing = null, onClose }) {
  const initNote = editing && editing.meta && !/^(added|from)/i.test(editing.meta) ? editing.meta : ''
  const initDue = editing
    ? (editing.due === 'this week' || editing.bucket === 'week' ? 'This week'
      : editing.due === 'tomorrow' ? 'Tomorrow' : 'Today')
    : 'Today'

  const [title, setTitle] = useState(editing ? editing.title : '')
  const [note, setNote] = useState(initNote)
  const [due, setDue] = useState(initDue)
  const [high, setHigh] = useState(editing ? !!editing.urgent : false)
  const [remind, setRemind] = useState('Off')
  // Track whether the user actually touched the reminder chip, so editing an
  // untouched task leaves its existing reminder alone (the chip can't yet show
  // an existing reminder, so a blind save must not wipe/rebuild it).
  const [remindTouched, setRemindTouched] = useState(false)

  // naive "AI" link: match the typed title against today's events
  const linked = useMemo(() => {
    const words = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    if (!words.length) return null
    return day.timeline.find((e) => words.some((w) => e.title.toLowerCase().includes(w))) || null
  }, [title, day.timeline])

  const submit = () => {
    if (!title.trim()) return onClose()
    const t = title.trim()
    const bucket = due === 'Today' ? 'today' : due === 'This week' ? 'week' : 'today'
    const dueVal = due === 'Today' ? 'today' : due.toLowerCase()
    let remindAt = null
    if (remind === 'In 1h') remindAt = new Date(day.now.getTime() + 3600000).toISOString()
    else if (remind === 'This evening') {
      const d = new Date(day.now)
      d.setHours(18, 0, 0, 0)
      remindAt = d.toISOString()
    }
    if (editing) {
      // `note` as-is (empty allowed, so a note can be cleared). Only include
      // remindAt when the user changed the reminder chip, so editTask leaves an
      // untouched reminder in place instead of cancelling it.
      const patch = { title: t, meta: note, urgent: high, bucket, due: dueVal }
      if (remindTouched) patch.remindAt = remindAt
      day.editTask(editing.id, patch)
    } else {
      day.addTask(t, { due: dueVal, urgent: high, bucket, note, remindAt })
    }
    onClose()
  }

  return (
    <div style={{ fontFamily: FONT_SANS }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Pressable onPress={onClose} style={{ fontSize: 15, fontWeight: 500, color: '#8a8a82' }}>Cancel</Pressable>
        <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 18, color: C.ink }}>{editing ? 'Edit task' : 'New task'}</span>
        <Pressable onPress={submit} style={{ padding: '8px 18px', background: C.blue, color: '#fff', borderRadius: 18, fontSize: 14, fontWeight: 600, boxShadow: '0 6px 16px rgba(26,24,240,.3)' }}>{editing ? 'Save' : 'Add'}</Pressable>
      </div>

      {/* title + note */}
      <div style={{ background: C.card, borderRadius: 20, padding: '18px', boxShadow: '0 6px 20px rgba(0,0,0,.05)', marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 13 }}>
        <div style={{ flex: 'none', width: 24, height: 24, borderRadius: 7, border: '2px solid #cfcec6', marginTop: 3 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="What needs doing?"
            style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontFamily: FONT_SERIF, fontSize: 23, fontWeight: 500, color: C.ink }}
          />
          <input
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Add details or a note…"
            style={{ width: '100%', marginTop: 5, border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5, color: '#6a6a62' }}
          />
        </div>
      </div>

      {/* AI suggestion */}
      {linked && (
        <div style={{ background: '#eceaf9', borderRadius: 16, padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 11, marginBottom: 18, border: '1px solid #ddd9f7' }}>
          <Spark />
          <span style={{ fontSize: 13, color: '#3a3a44', flex: 1, lineHeight: 1.4 }}>Looks tied to <b style={{ fontWeight: 600 }}>{linked.title} · {linked.time}</b></span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: C.blue, background: '#fff', padding: '6px 12px', borderRadius: 12 }}>Linked</span>
        </div>
      )}

      {/* options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <OptionRow icon={<CalIcon />} label="Due date">
          {['Today', 'Tomorrow', 'This week'].map((d) => (
            <Chip key={d} on={due === d} onPress={() => setDue(d)}>{d}</Chip>
          ))}
        </OptionRow>
        <OptionRow icon={<FlagIcon />} label="Priority">
          <Chip on={high} onPress={() => setHigh(true)} tone="red">High</Chip>
          <Chip on={!high} onPress={() => setHigh(false)}>Normal</Chip>
        </OptionRow>
        <OptionRow icon={<ClockIcon />} label="Remind me">
          {['Off', 'In 1h', 'This evening'].map((r) => (
            <Chip key={r} on={remind === r} onPress={() => { setRemind(r); setRemindTouched(true) }}>{r}</Chip>
          ))}
        </OptionRow>
      </div>

      {/* quick chips */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
        <QuickChip><LinkIcon /> Attach</QuickChip>
        <QuickChip><ListIcon /> Subtasks</QuickChip>
        {editing && (
          <Pressable
            onPress={() => { day.deleteTask(editing.id); onClose() }}
            style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: C.red, padding: '9px 14px' }}
          >Delete</Pressable>
        )}
      </div>
    </div>
  )
}

function OptionRow({ icon, label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, background: C.card, borderRadius: 15, padding: '13px 15px', boxShadow: '0 4px 14px rgba(0,0,0,.04)' }}>
      {icon}
      <span style={{ flex: 1, fontSize: 14.5, fontWeight: 500, color: C.ink }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{children}</div>
    </div>
  )
}
function QuickChip({ children }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: C.card, borderRadius: 14, fontSize: 13, fontWeight: 500, color: '#4a4a44', boxShadow: '0 3px 10px rgba(0,0,0,.05)' }}>{children}</span>
}
const CalIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}><rect x="3.5" y="4.5" width="17" height="16" rx="3.5" stroke="#6a6a62" strokeWidth="2" /><path d="M3.5 9h17" stroke="#6a6a62" strokeWidth="2" /><path d="M8 2.5v4M16 2.5v4" stroke="#6a6a62" strokeWidth="2" strokeLinecap="round" /></svg>)
const FlagIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}><path d="M6 3v18" stroke="#6a6a62" strokeWidth="2" strokeLinecap="round" /><path d="M6 4h11l-2 3 2 3H6" stroke={C.red} strokeWidth="2" strokeLinejoin="round" fill="rgba(255,59,48,.12)" /></svg>)
const ClockIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}><circle cx="12" cy="13" r="8" stroke="#6a6a62" strokeWidth="2" /><path d="M12 9v4l2.5 1.6" stroke="#6a6a62" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M9 2.5h6" stroke="#6a6a62" strokeWidth="2" strokeLinecap="round" /></svg>)
const LinkIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20.8 9.5l-8.5 8.5a5.5 5.5 0 01-7.8-7.8l8.5-8.5a3.7 3.7 0 015.2 5.2l-8.5 8.5a1.8 1.8 0 01-2.6-2.6l7.8-7.8" stroke="#6a6a62" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>)
const ListIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M7 8h10M7 12h7" stroke="#6a6a62" strokeWidth="2" strokeLinecap="round" /><rect x="3.5" y="3.5" width="17" height="17" rx="4" stroke="#6a6a62" strokeWidth="2" /></svg>)
function Chip({ on, onPress, children, tone }) {
  const onBg = tone === 'red' ? 'rgba(255,59,48,.1)' : '#eceaf9'
  const onFg = tone === 'red' ? C.red : C.blue
  return (
    <Pressable onPress={onPress} style={{
      fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 12,
      background: on ? onBg : 'transparent', color: on ? onFg : '#b0b0a8',
    }}>{children}</Pressable>
  )
}
const Spark = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}><path d="M12 2.5l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill={C.blue} /></svg>
)
