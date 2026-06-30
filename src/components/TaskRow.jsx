import { motion } from 'framer-motion'
import Pressable from './Pressable.jsx'
import { C, FONT_SANS } from '../theme.js'

// Source-badge palette
const SOURCE = {
  Email: { fg: '#1a18f0', bg: '#eceaf9' },
  Meeting: { fg: '#b06d0a', bg: '#fbecd2' },
  Calendar: { fg: '#1f8a5b', bg: '#dff0e8' },
  You: { fg: '#6a6a62', bg: '#eeede7' },
}

function decorate(t) {
  return {
    ringColor: t.done ? C.blue : t.urgent ? C.red : '#cfcec6',
    fillColor: t.done ? C.blue : 'transparent',
    titleColor: t.done ? '#a8a8a0' : C.ink,
    dueColor: t.done ? '#b0b0a8' : t.urgent ? C.red : C.inkSoft,
    dueBg: t.done ? C.paper2 : t.urgent ? 'rgba(255,59,48,.1)' : C.paper2,
  }
}

export default function TaskRow({ task, onToggle, onEdit, reduced }) {
  const canEdit = onEdit && task.source === 'You'
  const d = decorate(task)
  const src = SOURCE[task.source] || SOURCE.You
  const t = reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 30 }

  return (
    <motion.div
      layout={!reduced}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={t}
      whileTap={{ scale: 0.985 }}
      onClick={() => onToggle?.(task.id)}
      role="button"
      tabIndex={0}
      aria-pressed={task.done}
      aria-label={`${task.title}. ${task.done ? 'Completed' : 'Not completed'}. Press to toggle.`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.(task.id) }
      }}
      className="hq-focus"
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 13,
        background: C.card, borderRadius: 18, padding: 13,
        boxShadow: task.urgent && !task.done
          ? '0 0 0 1.5px rgba(255,59,48,.55), 0 6px 20px rgba(0,0,0,.05)'
          : '0 6px 20px rgba(0,0,0,.05)',
        cursor: 'pointer', outline: 'none',
      }}
    >
      {/* animated checkbox (rounded square, radius 7) */}
      <motion.div
        animate={{ backgroundColor: d.fillColor, borderColor: d.ringColor, scale: task.done ? [1, 1.22, 1] : 1 }}
        transition={reduced ? { duration: 0 } : { duration: 0.32, ease: 'easeOut' }}
        style={{
          flex: 'none', width: 24, height: 24, borderRadius: 7,
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

      <div style={{ flex: 1, minWidth: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: d.titleColor, fontFamily: FONT_SANS }}>{task.title}</span>
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
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5 }}>
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: src.fg, background: src.bg,
            padding: '2px 7px', borderRadius: 7, fontFamily: FONT_SANS,
          }}>{task.source}</span>
          <span style={{ fontSize: 12, color: C.muted, fontFamily: FONT_SANS, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.meta}</span>
        </div>
      </div>

      <span
        style={{
          flex: 'none', fontSize: 11, fontWeight: 600, color: d.dueColor, background: d.dueBg,
          padding: '5px 10px', borderRadius: 11, pointerEvents: 'none', fontFamily: FONT_SANS,
        }}
      >
        {task.due}
      </span>

      {canEdit && (
        <Pressable
          stop
          onPress={() => onEdit(task.id)}
          ariaLabel={`Edit ${task.title}`}
          style={{
            flex: 'none', width: 28, height: 28, borderRadius: 9, display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: C.muted,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </Pressable>
      )}
    </motion.div>
  )
}
