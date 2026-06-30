import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { C } from '../theme.js'

// Bottom sheet: scrim + spring-up panel. Controlled via `open`.
export default function Sheet({ open, onClose, children, reduced }) {
  // Escape to close + restore focus to whatever was focused before opening.
  useEffect(() => {
    if (!open) return
    const prev = typeof document !== 'undefined' ? document.activeElement : null
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (prev && typeof prev.focus === 'function') prev.focus()
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="scrim"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
          onClick={onClose}
          style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(20,18,14,.36)', backdropFilter: 'blur(1px)' }}
        >
          <motion.div
            key="panel"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 36 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, background: C.paper,
              borderRadius: '32px 32px 0 0', padding: '14px 20px calc(24px + env(safe-area-inset-bottom))',
              boxShadow: '0 -22px 54px rgba(0,0,0,.32)', maxHeight: '88%', overflowY: 'auto',
            }}
            role="dialog" aria-modal="true"
          >
            <div style={{ width: 42, height: 5, borderRadius: 3, background: '#dad9d2', margin: '0 auto 16px' }} />
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
