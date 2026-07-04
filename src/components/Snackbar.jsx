import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Pressable from './Pressable.jsx'
import { C, FONT_SANS } from '../theme.js'

// Floating undo/status bar above the tab bar. `snack` = { text, actionLabel?,
// onAction? } | null. Auto-dismisses; the action button fires once.
export default function Snackbar({ snack, onDismiss, reduced }) {
  useEffect(() => {
    if (!snack) return
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [snack, onDismiss])

  return (
    <AnimatePresence>
      {snack && (
        <motion.div
          key={snack.key || snack.text}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 34 }}
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute', left: 20, right: 20, zIndex: 45,
            bottom: 'calc(108px + env(safe-area-inset-bottom))',
            display: 'flex', alignItems: 'center', gap: 12,
            background: '#26251f', color: '#f4f3ee', borderRadius: 16,
            padding: '13px 16px', boxShadow: '0 14px 34px rgba(0,0,0,.3)',
            fontFamily: FONT_SANS, fontSize: 13.5, fontWeight: 500,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snack.text}</span>
          {snack.actionLabel && (
            <Pressable
              onPress={() => { snack.onAction?.(); onDismiss() }}
              style={{ flex: 'none', fontSize: 13, fontWeight: 700, color: '#9db1ff', padding: '6px 10px', margin: '-6px -10px' }}
            >{snack.actionLabel}</Pressable>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
