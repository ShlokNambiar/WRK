import { motion } from 'framer-motion'
import Pressable from './Pressable.jsx'
import { C } from '../theme.js'

const STEP = 52 // cell (46) + gap (6)
const BLOB = 46

const cell = {
  position: 'relative', zIndex: 1, width: 46, height: 46, borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const TABS = ['home', 'tasks', 'calendar', 'card']

export default function TabBar({ active = 'home', onTab, onAdd, reduced }) {
  const idx = Math.max(0, TABS.indexOf(active))
  const x = idx * STEP

  const lead = reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 30 }
  const trail = reduced ? { duration: 0 } : { type: 'spring', stiffness: 230, damping: 21, mass: 1.15 }

  return (
    <div
      style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 35,
        padding: '14px 24px calc(28px + env(safe-area-inset-bottom))',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11,
        background: 'linear-gradient(0deg,rgba(247,247,244,.95),rgba(247,247,244,.4) 70%,rgba(247,247,244,0))',
      }}
    >
      {/* SVG goo filter: blur + alpha threshold => metaball merge */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <filter id="wrk-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <nav
        aria-label="Primary"
        style={{
          position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px',
          background: 'rgba(255,255,255,.7)', backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)', borderRadius: 30,
          boxShadow: '0 10px 30px rgba(0,0,0,.12)', border: '1px solid rgba(255,255,255,.8)',
        }}
      >
        {/* soft glow that tracks the lead blob */}
        <motion.div
          aria-hidden="true"
          initial={false}
          animate={{ x }}
          transition={lead}
          style={{
            position: 'absolute', left: 12, top: 9, width: BLOB, height: BLOB, borderRadius: '50%',
            background: C.blue, filter: 'blur(9px)', opacity: 0.45, zIndex: 0, pointerEvents: 'none',
          }}
        />

        {/* goo layer: lead + trailing blob merge into a liquid bridge in motion */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', left: 12, top: 9, width: BLOB + STEP * 3, height: BLOB,
            filter: 'url(#wrk-goo)', zIndex: 0, pointerEvents: 'none', overflow: 'visible',
          }}
        >
          <motion.div
            initial={false}
            animate={{ x }}
            transition={trail}
            style={{ position: 'absolute', left: 0, top: 0, width: BLOB, height: BLOB, borderRadius: '50%', background: C.blue }}
          />
          <motion.div
            initial={false}
            animate={{ x }}
            transition={lead}
            style={{ position: 'absolute', left: 0, top: 0, width: BLOB, height: BLOB, borderRadius: '50%', background: C.blue }}
          />
        </div>

        {/* home / active — hamburger lines */}
        <Pressable ariaLabel="Home" onPress={() => onTab?.('home')} aria-current={active === 'home' ? 'page' : undefined} style={cell}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
            <span style={{ width: 18, height: 2.6, background: active === 'home' ? '#fff' : '#b8b8b0', borderRadius: 2, transition: 'background-color .2s' }} />
            <span style={{ width: 18, height: 2.6, background: active === 'home' ? '#fff' : '#b8b8b0', borderRadius: 2, transition: 'background-color .2s' }} />
            <span style={{ width: 12, height: 2.6, background: active === 'home' ? '#fff' : '#b8b8b0', borderRadius: 2, transition: 'background-color .2s' }} />
          </div>
        </Pressable>

        {/* tasks — rounded-square check */}
        <Pressable ariaLabel="Tasks" onPress={() => onTab?.('tasks')} aria-current={active === 'tasks' ? 'page' : undefined} style={cell}>
          <div style={{ width: 18, height: 18, borderRadius: 6, border: `2.5px solid ${active === 'tasks' ? '#fff' : '#b8b8b0'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color .2s', pointerEvents: 'none' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: active === 'tasks' ? '#fff' : '#b8b8b0', lineHeight: 1 }}>✓</span>
          </div>
        </Pressable>

        {/* calendar */}
        <Pressable ariaLabel="Calendar" onPress={() => onTab?.('calendar')} aria-current={active === 'calendar' ? 'page' : undefined} style={cell}>
          <div style={{ position: 'relative', width: 18, height: 17, borderRadius: 4, border: `2.5px solid ${active === 'calendar' ? '#fff' : '#b8b8b0'}`, transition: 'border-color .2s', pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', top: -5, left: 3, width: 2.5, height: 4, background: active === 'calendar' ? '#fff' : '#b8b8b0', borderRadius: 2 }} />
            <span style={{ position: 'absolute', top: -5, right: 3, width: 2.5, height: 4, background: active === 'calendar' ? '#fff' : '#b8b8b0', borderRadius: 2 }} />
            <span style={{ position: 'absolute', top: 3, left: -0.5, right: -0.5, height: 2.5, background: active === 'calendar' ? '#fff' : '#b8b8b0' }} />
          </div>
        </Pressable>

        {/* account / person */}
        <Pressable ariaLabel="Account" onPress={() => onTab?.('card')} aria-current={active === 'card' ? 'page' : undefined} style={cell}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ pointerEvents: 'none' }}>
            <circle cx="12" cy="8" r="3.6" stroke={active === 'card' ? '#fff' : '#b8b8b0'} strokeWidth="2" />
            <path d="M5.5 19.5c1-3.4 3.7-5 6.5-5s5.5 1.6 6.5 5" stroke={active === 'card' ? '#fff' : '#b8b8b0'} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </Pressable>
      </nav>

      {/* center + FAB */}
      <Pressable ariaLabel="Add task" onPress={onAdd} scale={0.9}
        style={{ width: 54, height: 54, borderRadius: '50%', background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 20px rgba(26,24,240,.32)' }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" style={{ pointerEvents: 'none' }}><path d="M12 5.5v13M5.5 12h13" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" /></svg>
      </Pressable>
    </div>
  )
}
