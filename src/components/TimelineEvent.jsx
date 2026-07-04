import { motion } from 'framer-motion'
import AttendeeStack from './AttendeeStack.jsx'
import Pressable from './Pressable.jsx'
import { openUrl } from '../lib/openUrl.js'
import { C, FONT_SANS } from '../theme.js'

// A single event on a timeline (Home + Calendar). `ev` is a buildTimeline()
// row. The card opens the event detail; Join launches the meeting link.
export default function TimelineEvent({ ev, isLast, reduced, onOpen }) {
  const t = reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 30 }
  const hi = ev.highlighted
  const timeColor = hi ? '#b06d0a' : C.ink
  const ampmColor = hi ? '#cfa24a' : '#b0b0a8'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: ev.isPast ? 0.55 : 1, y: 0 }}
      transition={t}
      style={{ display: 'flex', gap: 14, marginBottom: isLast ? 0 : 6 }}
    >
      {/* time column */}
      <div style={{ flex: 'none', width: 46, textAlign: 'right', paddingTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: timeColor }}>{ev.time}</div>
        <div style={{ fontSize: 10.5, color: ampmColor }}>{ev.ampm}</div>
      </div>

      {/* connector */}
      <div style={{ flex: 'none', width: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 18 }}>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: ev.accent, boxShadow: `0 0 0 3px ${hexA(ev.accent, 0.16)}` }} />
        {!isLast && <span style={{ flex: 1, width: 2, background: '#e8e7df', marginTop: 4 }} />}
      </div>

      {/* card */}
      <Pressable
        onPress={onOpen ? () => onOpen(ev) : undefined}
        ariaLabel={`${ev.title}, ${ev.durLabel}`}
        style={{
          flex: 1, minWidth: 0, background: hi ? '#fbecd2' : C.card, borderRadius: 16,
          padding: '13px 15px', boxShadow: '0 4px 14px rgba(0,0,0,.05)',
          textAlign: 'left', display: 'block',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: hi ? '#7a4d04' : C.ink, fontFamily: FONT_SANS, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</div>
          <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: hi ? '#b06d0a' : ev.accent, background: hi ? '#fff' : hexA(ev.accent, 0.1), padding: '3px 8px', borderRadius: 8 }}>{ev.durLabel}</span>
        </div>

        {/* moved badge */}
        {ev.movedBadge && (
          <div style={{ marginTop: 9 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, color: '#b06d0a', background: '#fff', padding: '3px 8px', borderRadius: 8 }}>
              <Clock /> {ev.movedBadge.toUpperCase()}
            </span>
          </div>
        )}

        {/* people + join — a hybrid meeting shows its room too */}
        {(ev.avatars.length > 0 || ev.joinUrl) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 11 }}>
            {ev.avatars.length ? <AttendeeStack avatars={ev.avatars} overflow={ev.overflow} /> : <span />}
            {ev.joinUrl && (
              <Pressable
                stop
                onPress={() => openUrl(ev.joinUrl)}
                ariaLabel={`Join ${ev.title}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
                  color: C.blue, background: '#eceaf9', padding: '9px 13px', borderRadius: 11,
                }}
              >
                <Video /> Join
              </Pressable>
            )}
          </div>
        )}
        {ev.location && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9, color: C.muted, fontSize: 12.5 }}>
            <Pin /> <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.location}</span>
          </div>
        )}
      </Pressable>
    </motion.div>
  )
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
const Video = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M3.5 7.5a2 2 0 012-2h7a2 2 0 012 2v9a2 2 0 01-2 2h-7a2 2 0 01-2-2z" stroke={C.blue} strokeWidth="2" /><path d="M16.5 10l4-2.5v9l-4-2.5z" fill={C.blue} /></svg>
)
const Pin = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-5.6 7-11a7 7 0 10-14 0c0 5.4 7 11 7 11z" stroke="#b0b0a8" strokeWidth="2" /><circle cx="12" cy="10" r="2.4" stroke="#b0b0a8" strokeWidth="2" /></svg>
)
const Clock = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 8v5l3 2" stroke="#b06d0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="13" r="8" stroke="#b06d0a" strokeWidth="2" /></svg>
)
