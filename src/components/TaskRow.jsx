import { memo } from 'react'
import { motion } from 'framer-motion'
import Pressable from './Pressable.jsx'
import { C, FONT_SANS } from '../theme.js'

// Source-badge palette
const SOURCE = {
  Email: { fg: '#1a18f0', bg: '#eceaf9' },
  Meeting: { fg: '#8a5606', bg: '#fbecd2' },
  Calendar: { fg: '#1f8a5b', bg: '#dff0e8' },
  You: { fg: '#6a6a62', bg: '#eeede7' },
}

function decorate(t) {
  return {
    ringColor: t.done ? C.blue : t.urgent ? C.red : '#cfcec6',
    fillColor: t.done ? C.blue : 'transparent',
    titleColor: t.done ? '#a8a8a0' : C.ink,
    // urgent pill text darkened from C.red (#ff3b30, 3.55:1) so 11px text
    // clears WCAG AA (4.99:1 on the tinted pill bg); done gray is intentional.
    dueColor: t.done ? '#b0b0a8' : t.urgent ? '#c8210f' : C.inkSoft,
    dueBg: t.done ? C.paper2 : t.urgent ? 'rgba(255,59,48,.1)' : C.paper2,
  }
}

// Interaction model: the CHECKBOX toggles done; the row body opens the task
// (edit sheet for manual tasks, detail sheet for auto/email ones). A whole-row
// toggle made every mis-tap silently complete a task — the worst possible
// outcome for a stray touch.
function TaskRow({ task, onToggle, onEdit, onDetail, reduced }) {
  const canEdit = onEdit && task.source === 'You'
  const canDetail = onDetail && task.source !== 'You'
  const openRow = canEdit ? () => onEdit(task.id) : canDetail ? () => onDetail(task) : null
  const d = decorate(task)
  const src = SOURCE[task.source] || SOURCE.You
  const t = reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 30 }
  const sub = task.note || task.meta

  return (
    <motion.div
      layout={!reduced}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={t}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 11,
        background: C.card, borderRadius: 18, padding: '9px 13px 9px 9px',
        boxShadow: task.urgent && !task.done
          ? '0 0 0 1.5px rgba(255,59,48,.55), 0 6px 20px rgba(0,0,0,.05)'
          : '0 6px 20px rgba(0,0,0,.05)',
      }}
    >
      {/* animated checkbox — the only surface that completes the task */}
      <Pressable
        onPress={() => onToggle?.(task.id)}
        ariaLabel={`${task.title}. ${task.done ? 'Completed — press to reopen' : 'Press to complete'}`}
        style={{
          flex: 'none', width: 44, height: 44, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <motion.div
          animate={{ backgroundColor: d.fillColor, borderColor: d.ringColor, scale: task.done ? [1, 1.22, 1] : 1 }}
          transition={reduced ? { duration: 0 } : { duration: 0.32, ease: 'easeOut' }}
          style={{
            width: 24, height: 24, borderRadius: 7,
            border: `2px solid ${d.ringColor}`, display: 'flex',
            alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
          }}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
            <motion.path
              d="M5 12.5 L10 17 L19 7"
              stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
              initial={false}
              animate={{ pathLength: task.done ? 1 : 0, opacity: task.done ? 1 : 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
            />
          </svg>
        </motion.div>
      </Pressable>

      {/* row body — opens the task, never completes it */}
      <Pressable
        onPress={openRow || (() => onToggle?.(task.id))}
        ariaLabel={openRow ? `Open ${task.title}` : task.title}
        style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10,
          textAlign: 'left', padding: '4px 0',
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: d.titleColor, fontFamily: FONT_SANS, display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
            {/* animated strike-through sweep */}
            <motion.span
              aria-hidden="true"
              initial={false}
              animate={{ scaleX: task.done ? 1 : 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
              style={{
                position: 'absolute', left: 0, top: '50%', width: '100%', height: 1.5,
                background: '#a8a8a0', transformOrigin: 'left center',
              }}
            />
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5 }}>
            <span style={{
              fontSize: 10.5, fontWeight: 700, color: src.fg, background: src.bg,
              padding: '2px 7px', borderRadius: 7, fontFamily: FONT_SANS, flex: 'none',
            }}>{task.source}</span>
            <span style={{ fontSize: 12, color: C.muted, fontFamily: FONT_SANS, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
          </span>
        </span>

        <span
          style={{
            flex: 'none', fontSize: 11, fontWeight: 600, color: d.dueColor, background: d.dueBg,
            padding: '5px 10px', borderRadius: 11, fontFamily: FONT_SANS,
          }}
        >
          {task.due}
        </span>
        {openRow && <span aria-hidden="true" style={{ flex: 'none', fontSize: 15, color: C.faint, fontWeight: 600 }}>›</span>}
      </Pressable>
    </motion.div>
  )
}

export default memo(TaskRow)
