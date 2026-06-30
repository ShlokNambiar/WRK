import { C } from '../theme.js'

// The red "current time" line on a timeline.
export default function NowMarker({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 10px', paddingLeft: 60 }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: C.red }} />
      <span style={{ flex: 1, height: 2, background: C.red, borderRadius: 2 }} />
      <span style={{ fontSize: 10, fontWeight: 700, color: C.red, letterSpacing: '.04em' }}>{label}</span>
    </div>
  )
}
