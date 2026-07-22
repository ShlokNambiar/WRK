import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Pressable from './Pressable.jsx'
import { FONT_SANS } from '../theme.js'

// Floating undo/status bar above the tab bar. `snack` = { text, actionLabel?,
// onAction? } | null. Auto-dismisses; the action button fires once.
//
// The live region is permanently mounted and separate from the animated card:
// screen readers only announce changes INSIDE an existing live region — a
// region inserted together with its content (the old AnimatePresence child)
// frequently announces nothing on TalkBack.
export default function Snackbar({ snack, onDismiss, reduced }) {
  // Auto-dismiss keyed on the snack alone: with the callback in the dep list a
  // parent re-render (new inline onDismiss identity) restarted the 7s timer.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  useEffect(() => {
    if (!snack) return
    // 7s, not 5 — a TalkBack user needs the window to reach the Undo button
    const t = setTimeout(() => dismissRef.current?.(), 7000)
    return () => clearTimeout(t)
  }, [snack])

  return (
    <>
      <span role="status" aria-live="polite" style={{
        position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
        overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
      }}>{snack ? snack.text : ''}</span>
      <AnimatePresence>
        {snack && (
          <motion.div
            key={snack.key || snack.text}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 34 }}
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
                style={{
                  flex: 'none', fontSize: 13, fontWeight: 700, color: '#9db1ff',
                  padding: '14px 12px', margin: '-14px -12px', minHeight: 44,
                  display: 'inline-flex', alignItems: 'center',
                }}
              >{snack.actionLabel}</Pressable>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
