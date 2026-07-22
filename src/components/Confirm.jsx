import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Pressable from './Pressable.jsx'
import { C, FONT_SERIF, FONT_SANS } from '../theme.js'

// In-app confirm dialog for destructive actions (sign out, discard draft,
// delete). `ask` = { title, body?, confirmLabel, tone?: 'red', onConfirm } | null.
export default function Confirm({ ask, onClose, reduced }) {
  const open = !!ask
  const cancelRef = useRef(null)

  // Same pattern as Sheet.jsx: Escape closes (cancel path), focus lands on the
  // Cancel button on open, and returns to the previous element on close.
  useEffect(() => {
    if (!open) return
    const prev = typeof document !== 'undefined' ? document.activeElement : null
    cancelRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (prev && typeof prev.focus === 'function') prev.focus()
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {ask && (
        <motion.div
          key="confirm-scrim"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
          onClick={onClose}
          style={{
            position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(20,18,14,.44)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28,
          }}
        >
          <motion.div
            key="confirm-card"
            initial={reduced ? false : { scale: 0.94, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { scale: 0.96, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog" aria-modal="true" aria-label={ask.title}
            style={{
              width: '100%', maxWidth: 320, background: C.paper, borderRadius: 24,
              padding: '22px 20px 16px', boxShadow: '0 24px 60px rgba(0,0,0,.35)', fontFamily: FONT_SANS,
            }}
          >
            <div style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 19, color: C.ink, lineHeight: 1.2 }}>{ask.title}</div>
            {ask.body && <p style={{ fontSize: 13.5, lineHeight: 1.5, color: C.inkSoft, margin: '9px 0 0' }}>{ask.body}</p>}
            <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
              <Pressable ref={cancelRef} onPress={onClose} style={{
                flex: 1, minHeight: 46, borderRadius: 14, background: '#eeede7',
                fontSize: 14, fontWeight: 600, color: C.ink,
              }}>Cancel</Pressable>
              <Pressable onPress={() => { ask.onConfirm?.(); onClose() }} style={{
                flex: 1, minHeight: 46, borderRadius: 14,
                background: ask.tone === 'red' ? C.red : C.blue, color: '#fff',
                fontSize: 14, fontWeight: 600,
                boxShadow: ask.tone === 'red' ? '0 8px 20px rgba(255,59,48,.3)' : '0 8px 20px rgba(26,24,240,.3)',
              }}>{ask.confirmLabel || 'Confirm'}</Pressable>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
