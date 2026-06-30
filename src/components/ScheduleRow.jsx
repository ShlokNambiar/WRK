import { motion } from 'framer-motion'
import { C, FONT_SANS, FONT_SERIF } from '../theme.js'

// A single schedule item in the "Today" section: time column, colored accent
// bar, title + meta, and an optional badge (e.g. "MOVED from 2:00").
export default function ScheduleRow({ item, reduced }) {
  const t = reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 30 }
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={t}
      whileTap={{ scale: 0.99 }}
      style={{
        display: 'flex', alignItems: 'stretch', gap: 12,
        background: C.card, borderRadius: 18, padding: '12px 14px',
        boxShadow: '0 6px 20px rgba(0,0,0,.05)',
      }}
    >
      {/* time column */}
      <div style={{ flex: 'none', width: 46, textAlign: 'right', paddingTop: 1 }}>
        <div style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 16, color: C.ink, lineHeight: 1 }}>{item.time}</div>
        {item.dur && <div style={{ fontSize: 11, color: C.muted, marginTop: 3, fontFamily: FONT_SANS }}>{item.dur}</div>}
      </div>

      {/* accent bar */}
      <span style={{ flex: 'none', width: 4, borderRadius: 4, background: item.accent }} aria-hidden="true" />

      {/* body */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: C.ink, fontFamily: FONT_SANS }}>{item.title}</span>
          {item.badge && (
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: '.03em', textTransform: 'uppercase',
              color: '#b06d0a', background: '#fbecd2', padding: '3px 8px', borderRadius: 8, fontFamily: FONT_SANS,
            }}>{item.badge}</span>
          )}
        </div>
        {item.meta && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, fontFamily: FONT_SANS }}>{item.meta}</div>}
      </div>
    </motion.div>
  )
}
