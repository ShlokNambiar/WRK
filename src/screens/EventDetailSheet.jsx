import Pressable from '../components/Pressable.jsx'
import { avatarGradient, fmtTime } from '../lib/derive.js'
import { openUrl } from '../lib/openUrl.js'
import { C, FONT_SERIF, FONT_SANS } from '../theme.js'

// Full event view — the timeline card finally opens into something. `ev` is a
// buildTimeline() row; `ev.raw` is the normalized event underneath.
export default function EventDetailSheet({ ev, onClose }) {
  const raw = ev?.raw
  if (!raw) return null
  const dayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(raw.start)
  const timeLabel = raw.allDay
    ? 'All day'
    : `${fmtTime(raw.start)} ${raw.start.getHours() >= 12 ? 'pm' : 'am'} – ${fmtTime(raw.end)} ${raw.end.getHours() >= 12 ? 'pm' : 'am'}`
  const others = (raw.attendeesList || []).filter((a) => !a.self)
  // strip bare URLs out of the description preview (the doc link gets a button)
  const desc = (raw.description || '').replace(/https?:\/\/[^\s)]+/g, '').trim()

  return (
    <div style={{ fontFamily: FONT_SANS }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
        <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 24, lineHeight: 1.15, color: C.ink, margin: 0 }}>{raw.title}</h2>
        <Pressable onPress={onClose} ariaLabel="Close" style={{ flex: 'none', width: 34, height: 34, borderRadius: '50%', background: '#eeede7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: C.inkSoft }}>✕</Pressable>
      </div>
      <div style={{ fontSize: 13.5, color: C.inkSoft, marginBottom: 16 }}>{dayLabel} · {timeLabel}</div>

      {ev.movedBadge && (
        <div style={{ marginBottom: 14 }}>
          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color: '#b06d0a', background: '#fbecd2', padding: '5px 10px', borderRadius: 9 }}>{ev.movedBadge.toUpperCase()}</span>
        </div>
      )}

      {/* primary actions */}
      <div style={{ display: 'flex', gap: 9, marginBottom: 18, flexWrap: 'wrap' }}>
        {ev.joinUrl && (
          <Pressable onPress={() => openUrl(ev.joinUrl)} style={{
            flex: 1, minWidth: 130, minHeight: 48, borderRadius: 15, background: C.blue, color: '#fff',
            fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: '0 8px 22px rgba(26,24,240,.3)',
          }}>▶ Join meeting</Pressable>
        )}
        {raw.docLink && (
          <Pressable onPress={() => openUrl(raw.docLink)} style={{
            flex: 1, minWidth: 130, minHeight: 48, borderRadius: 15, background: '#eceaf9', color: C.blue,
            fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>Open linked doc</Pressable>
        )}
      </div>

      {raw.location && (
        <Section label="Where">
          <div style={{ fontSize: 14.5, color: C.ink }}>{raw.location}</div>
        </Section>
      )}

      {others.length > 0 && (
        <Section label={`People · ${others.length + 1}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {others.slice(0, 8).map((a) => (
              <div key={a.email} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span aria-hidden="true" style={{ flex: 'none', width: 28, height: 28, borderRadius: '50%', background: avatarGradient(a.email) }} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13.5, color: C.ink }}>
                  {a.name || a.email}
                  {a.email === raw.organizer && <span style={{ color: C.muted, fontSize: 12 }}> · organizer</span>}
                </span>
              </div>
            ))}
            {others.length > 8 && <div style={{ fontSize: 12.5, color: C.muted }}>+{others.length - 8} more</div>}
          </div>
        </Section>
      )}

      {desc && (
        <Section label="Details">
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: C.inkSoft, whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}>{desc}</div>
        </Section>
      )}
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, marginBottom: 7 }}>{label}</div>
      {children}
    </div>
  )
}
