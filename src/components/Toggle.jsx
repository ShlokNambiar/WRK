import { motion } from 'framer-motion'
import { C } from '../theme.js'

// iOS-style switch. The visible track stays 44×27, but the button's hit area
// is extended to 44×45 with vertical padding + negative margin (same trick as
// AddTaskSheet's Cancel button) so the touch target meets the 44px minimum
// without shifting surrounding layout.
export default function Toggle({ on, onChange, reduced }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange?.(!on)}
      className="hq-focus"
      style={{
        border: 'none', background: 'none', cursor: 'pointer',
        padding: '9px 0', margin: '-9px 0', display: 'block',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span
        style={{
          display: 'block', width: 44, height: 27, borderRadius: 14,
          background: on ? C.blue : '#d8d7cf', position: 'relative',
          transition: 'background-color .2s', pointerEvents: 'none',
        }}
      >
        <motion.span
          layout
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 600, damping: 32 }}
          style={{
            position: 'absolute', top: 2, left: on ? 19 : 2, width: 23, height: 23,
            borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
          }}
        />
      </span>
    </button>
  )
}
