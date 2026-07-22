import { useEffect, useMemo, useRef, useState } from 'react'
import Pressable from '../components/Pressable.jsx'
import { isoDateStr, addDays, dueLabel } from '../lib/derive.js'
import { C, FONT_SERIF, FONT_SANS } from '../theme.js'

// Which chip matches a stored dueDate (or null for a custom date).
function chipForDate(dueDate, now) {
  if (!dueDate) return 'Today'
  if (dueDate === isoDateStr(now)) return 'Today'
  if (dueDate === isoDateStr(addDays(now, 1))) return 'Tomorrow'
  return 'Custom'
}

// Inner content of the Add/Edit-task bottom sheet. Wrapped by <Sheet> in WrkApp.
// onDirtyChange tells the host whether closing should ask "Discard draft?".
export default function AddTaskSheet({ day, editing = null, onClose, onDirtyChange, onDeleted }) {
  const now = day.now
  const [title, setTitle] = useState(editing ? editing.title : '')
  const [note, setNote] = useState(editing ? (editing.note || '') : '')
  const [dueDate, setDueDate] = useState(editing ? (editing.dueDate || isoDateStr(now)) : isoDateStr(now))
  const [dueChip, setDueChip] = useState(editing ? chipForDate(editing.dueDate, now) : 'Today')
  const [high, setHigh] = useState(editing ? !!editing.urgent : false)
  const [titleHint, setTitleHint] = useState(false)
  const [added, setAdded] = useState(0) // rapid-capture counter
  const titleRef = useRef(null)
  const dateRef = useRef(null)

  // Reminder: show the task's EXISTING reminder instead of pretending it's off.
  const existingRemind = editing?.remindAt && new Date(editing.remindAt) > now ? editing.remindAt : null
  const [remind, setRemind] = useState(existingRemind ? 'Keep' : 'Off')
  const [remindTouched, setRemindTouched] = useState(false)
  // after ~5:30pm "this evening" is gone (getHours() is an integer — the
  // fractional compare silently meant 6:00pm before)
  const eveningPast = now.getHours() + now.getMinutes() / 60 >= 17.5
  const eveningLabel = eveningPast ? 'Tmrw evening' : 'This evening'
  const keepLabel = existingRemind
    ? new Date(existingRemind).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null

  // dirty = anything typed/changed in ADD mode (edit mode closes freely; Save
  // is explicit there and nothing is lost by cancelling).
  const dirty = !editing && (title.trim() !== '' || note.trim() !== '')
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  // naive "AI" link: match the typed title against today's events
  const linked = useMemo(() => {
    const words = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    if (!words.length) return null
    return day.timeline.find((e) => words.some((w) => e.title.toLowerCase().includes(w))) || null
  }, [title, day.timeline])

  const pickChip = (chip) => {
    setDueChip(chip)
    if (chip === 'Today') setDueDate(isoDateStr(now))
    else if (chip === 'Tomorrow') setDueDate(isoDateStr(addDays(now, 1)))
    else if (chip === 'Custom') {
      // open the native date picker
      try { dateRef.current?.showPicker ? dateRef.current.showPicker() : dateRef.current?.focus() } catch {}
    }
  }

  const remindAtFor = (choice) => {
    if (choice === 'Keep') return existingRemind
    if (choice === 'In 1h') return new Date(now.getTime() + 3600000).toISOString()
    if (choice === 'This evening') {
      const d = new Date(now)
      if (eveningPast) d.setDate(d.getDate() + 1)
      d.setHours(18, 0, 0, 0)
      return d.toISOString()
    }
    return null
  }

  const submit = (keepOpen = false) => {
    if (!title.trim()) {
      // never silently discard a filled note behind an empty title
      setTitleHint(true)
      try { titleRef.current?.focus() } catch {}
      return
    }
    setTitleHint(false)
    const t = title.trim()
    const remindAt = remindAtFor(remind)
    if (editing) {
      const patch = { title: t, note, urgent: high, dueDate }
      if (remindTouched) patch.remindAt = remindAt
      day.editTask(editing.id, patch)
      onClose()
      return
    }
    day.addTask(t, { dueDate, urgent: high, note, remindAt })
    if (keepOpen) {
      // rapid capture: clear and stay open for the next thought
      setTitle(''); setNote(''); setHigh(false)
      setRemind('Off'); setRemindTouched(false)
      setAdded((n) => n + 1)
      try { titleRef.current?.focus() } catch {}
    } else {
      onDirtyChange?.(false) // saved, not discarded — close without the guard
      onClose()
    }
  }

  const remindChoices = existingRemind ? ['Keep', 'Off', 'In 1h', eveningLabel] : ['Off', 'In 1h', eveningLabel]

  return (
    <div style={{ fontFamily: FONT_SANS }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Pressable onPress={onClose} style={{ fontSize: 15, fontWeight: 500, color: '#6f6e63', padding: '12px 8px', margin: '-12px -8px', minHeight: 44 }}>Cancel</Pressable>
        <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 18, color: C.ink }}>
          {editing ? 'Edit task' : added ? `New task · ${added} added` : 'New task'}
        </span>
        <Pressable onPress={() => submit(false)} style={{ padding: '10px 18px', background: C.blue, color: '#fff', borderRadius: 18, fontSize: 14, fontWeight: 600, boxShadow: '0 6px 16px rgba(26,24,240,.3)' }}>{editing ? 'Save' : 'Add'}</Pressable>
      </div>

      {/* title + note */}
      <div style={{ background: C.card, borderRadius: 20, padding: '18px', boxShadow: '0 6px 20px rgba(0,0,0,.05)', marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 13 }}>
        <div style={{ flex: 'none', width: 24, height: 24, borderRadius: 7, border: `2px solid ${titleHint ? C.red : '#cfcec6'}`, marginTop: 3 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            ref={titleRef}
            autoFocus value={title} onChange={(e) => { setTitle(e.target.value); if (titleHint) setTitleHint(false) }}
            onKeyDown={(e) => e.key === 'Enter' && submit(true)}
            placeholder="What needs doing?"
            aria-label="Task title"
            style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontFamily: FONT_SERIF, fontSize: 23, fontWeight: 500, color: C.ink }}
          />
          {titleHint && <div style={{ fontSize: 12, color: C.red, marginTop: 2 }}>Give it a title first</div>}
          <input
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Add details or a note…"
            aria-label="Task note"
            style={{ width: '100%', marginTop: 5, border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5, color: '#6a6a62' }}
          />
        </div>
      </div>

      {/* AI suggestion */}
      {linked && (
        <div style={{ background: '#eceaf9', borderRadius: 16, padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 11, marginBottom: 18, border: '1px solid #ddd9f7' }}>
          <Spark />
          <span style={{ fontSize: 13, color: '#3a3a44', flex: 1, lineHeight: 1.4 }}>Looks tied to <b style={{ fontWeight: 600 }}>{linked.title} · {linked.time}</b></span>
        </div>
      )}

      {/* options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <OptionRow icon={<CalIcon />} label="Due">
          {['Today', 'Tomorrow'].map((d) => (
            <Chip key={d} on={dueChip === d} onPress={() => pickChip(d)}>{d}</Chip>
          ))}
          <Chip on={dueChip === 'Custom'} onPress={() => pickChip('Custom')}>
            {dueChip === 'Custom' ? dueLabel(dueDate, now) || 'Pick…' : 'Pick…'}
          </Chip>
          {/* hidden native date input driving the Custom chip */}
          <input
            ref={dateRef} type="date" value={dueDate} min={isoDateStr(now)}
            onChange={(e) => { if (e.target.value) { setDueDate(e.target.value); setDueChip(chipForDate(e.target.value, now)) } }}
            aria-label="Pick a due date"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
        </OptionRow>
        <OptionRow icon={<FlagIcon />} label="Priority">
          <Chip on={high} onPress={() => setHigh(true)} tone="red">High</Chip>
          <Chip on={!high} onPress={() => setHigh(false)}>Normal</Chip>
        </OptionRow>
        <OptionRow icon={<ClockIcon />} label="Remind me">
          {remindChoices.map((r) => (
            <Chip key={r} on={remind === (r === eveningLabel ? 'This evening' : r)} onPress={() => { setRemind(r === eveningLabel ? 'This evening' : r); setRemindTouched(true) }}>
              {r === 'Keep' ? `At ${keepLabel}` : r}
            </Chip>
          ))}
        </OptionRow>
      </div>

      {/* delete (edit mode) */}
      {editing && (
        <div style={{ display: 'flex', marginTop: 16 }}>
          <Pressable
            onPress={() => { const removed = day.deleteTask(editing.id); onClose(); onDeleted?.(removed) }}
            style={{ marginLeft: 'auto', fontSize: 13.5, fontWeight: 600, color: C.red, padding: '12px 16px', minHeight: 44 }}
          >Delete task</Pressable>
        </div>
      )}
    </div>
  )
}

function OptionRow({ icon, label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, background: C.card, borderRadius: 15, padding: '10px 15px', boxShadow: '0 4px 14px rgba(0,0,0,.04)', position: 'relative' }}>
      {icon}
      <span style={{ flex: 1, fontSize: 14.5, fontWeight: 500, color: C.ink }}>{label}</span>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>{children}</div>
    </div>
  )
}
const CalIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}><rect x="3.5" y="4.5" width="17" height="16" rx="3.5" stroke="#6a6a62" strokeWidth="2" /><path d="M3.5 9h17" stroke="#6a6a62" strokeWidth="2" /><path d="M8 2.5v4M16 2.5v4" stroke="#6a6a62" strokeWidth="2" strokeLinecap="round" /></svg>)
const FlagIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}><path d="M6 3v18" stroke="#6a6a62" strokeWidth="2" strokeLinecap="round" /><path d="M6 4h11l-2 3 2 3H6" stroke={C.red} strokeWidth="2" strokeLinejoin="round" fill="rgba(255,59,48,.12)" /></svg>)
const ClockIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}><circle cx="12" cy="13" r="8" stroke="#6a6a62" strokeWidth="2" /><path d="M12 9v4l2.5 1.6" stroke="#6a6a62" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M9 2.5h6" stroke="#6a6a62" strokeWidth="2" strokeLinecap="round" /></svg>)
function Chip({ on, onPress, children, tone }) {
  const onBg = tone === 'red' ? 'rgba(255,59,48,.1)' : '#eceaf9'
  const onFg = tone === 'red' ? C.red : C.blue
  return (
    <Pressable onPress={onPress} ariaPressed={on} style={{
      fontSize: 12.5, fontWeight: 600, padding: '11px 12px', borderRadius: 12, minHeight: 44,
      background: on ? onBg : 'transparent', color: on ? onFg : '#6f6e63',
    }}>{children}</Pressable>
  )
}
const Spark = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}><path d="M12 2.5l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill={C.blue} /></svg>
)
