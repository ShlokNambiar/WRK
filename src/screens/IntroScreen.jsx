import { motion } from 'framer-motion'
import Pressable from '../components/Pressable.jsx'
import { C, FONT_SERIF, FONT_SANS, SPRING } from '../theme.js'

// One-time first-run intro. Before this existed, a brand-new install opened
// straight into a stranger's fake day ("Alex") with no explanation of what the
// app does or why it will ask for Calendar + Gmail — right before the
// highest-friction consent flow in mobile. Shown once (wrk.seenIntro), only
// while signed out; "Explore the demo" is the skip path.
export default function IntroScreen({ reduced, onDone }) {
  const fade = (delay) => ({
    initial: reduced ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { ...SPRING, delay: reduced ? 0 : delay },
  })
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 60, background: C.paper,
      display: 'flex', flexDirection: 'column', overflowY: 'auto',
      padding: '0 26px', fontFamily: FONT_SANS,
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 'calc(24px + env(safe-area-inset-top))' }}>
        <motion.div {...fade(0)}>
          <div style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, color: C.ink, letterSpacing: '.06em' }}>WRK</div>
          <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 34, lineHeight: 1.12, letterSpacing: '-.015em', color: C.ink, margin: '18px 0 0' }}>
            Your day,<br />already assembled.
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: C.inkSoft, margin: '14px 0 0' }}>
            Every morning WRK builds one calm screen: your schedule, the emails
            that actually need a reply, and a short brief that ties it together.
          </p>
        </motion.div>

        <motion.div {...fade(0.08)} style={{ marginTop: 26, background: C.card, borderRadius: 18, padding: '15px 17px', boxShadow: '0 6px 20px rgba(0,0,0,.05)' }}>
          <IntroLine icon="📅" head="Calendar · read-only" body="Builds your timeline and daily brief." />
          <IntroLine icon="✉️" head="Gmail · read-only" body="Only subject + sender are read — never the body. Bulk mail is filtered out." />
          <IntroLine icon="🔒" head="Nothing is touched" body="WRK can’t send, delete, or change anything in your account." last />
        </motion.div>
      </div>

      <motion.div {...fade(0.16)} style={{ paddingBottom: 'calc(26px + env(safe-area-inset-bottom))' }}>
        <Pressable onPress={() => onDone(true)} scale={0.98}
          style={{ display: 'block', width: '100%', background: C.blue, color: '#fff', borderRadius: 16, padding: 16, textAlign: 'center', fontSize: 15.5, fontWeight: 600, boxShadow: '0 14px 30px rgba(26,24,240,.25)', minHeight: 52 }}>
          Get started
        </Pressable>
        <Pressable onPress={() => onDone(false)} scale={0.98}
          style={{ display: 'block', width: '100%', marginTop: 10, background: 'transparent', color: C.muted, borderRadius: 16, padding: 13, textAlign: 'center', fontSize: 13.5, fontWeight: 600, minHeight: 44 }}>
          Explore the demo first
        </Pressable>
      </motion.div>
    </div>
  )
}

function IntroLine({ icon, head, body, last }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', paddingBottom: last ? 0 : 12, marginBottom: last ? 0 : 12, borderBottom: last ? 'none' : '1px solid #f3f2ec' }}>
      <span aria-hidden="true" style={{ fontSize: 16, flex: 'none', marginTop: 1 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: C.ink }}>{head}</span>
        <span style={{ display: 'block', fontSize: 12.5, lineHeight: 1.5, color: C.muted, marginTop: 2 }}>{body}</span>
      </span>
    </div>
  )
}
