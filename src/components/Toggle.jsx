import { motion } from 'framer-motion'
import { C } from '../theme.js'

// iOS-style switch.
export default function Toggle({ on, onChange, reduced }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange?.(!on)}
      className="hq-focus"
      style={{
        width: 44, height: 27, borderRadius: 14, border: 'none', padding: 0, cursor: 'pointer',
        background: on ? C.blue : '#d8d7cf', position: 'relative', transition: 'background-color .2s',
        WebkitTapHighlightColor: 'transparent',
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
    </button>
  )
}
