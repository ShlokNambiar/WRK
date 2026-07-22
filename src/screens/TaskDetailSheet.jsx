import { useState } from 'react'
import Pressable from '../components/Pressable.jsx'
import { setEmailRule } from '../lib/cloud.js'
import { openUrl } from '../lib/openUrl.js'
import { C, FONT_SERIF, FONT_SANS } from '../theme.js'

// Detail view for AUTO/EMAIL tasks (manual tasks open the edit sheet instead).
// Gives the app's auto-drafted suggestions a correction path: open the source,
// dismiss, or mute the sender so it never suggests them again.
export default function TaskDetailSheet({ task, day, onClose, onSnack }) {
  const [muting, setMuting] = useState(false)
  if (!task) return null
  const isEmail = task.source === 'Email'
  const isHq = task.source === 'HQ' // Claude-planned (HQ mode)
  const threadId = isEmail && task.id.startsWith('mail:') ? task.id.slice(5) : null
  const gmailUrl = threadId ? `https://mail.google.com/mail/u/0/#all/${threadId}` : null

  const mute = async () => {
    if (!task.sender || muting) return
    setMuting(true)
    try {
      await setEmailRule(task.sender, 'mute')
      day.toggleTask(task.id) // clear it from today too
      onClose()
      onSnack?.({
        text: `Muted ${task.sender} — no more tasks from them`,
        actionLabel: 'Undo',
        onAction: async () => {
          try { const { removeEmailRule } = await import('../lib/cloud.js'); await removeEmailRule(task.sender) } catch {}
          day.toggleTask(task.id)
        },
      })
    } catch {
      onSnack?.({ text: "Couldn't mute — check your connection" })
      setMuting(false)
    }
  }

  return (
    <div style={{ fontFamily: FONT_SANS }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
        <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 22, lineHeight: 1.2, color: C.ink, margin: 0 }}>{task.title}</h2>
        <Pressable onPress={onClose} ariaLabel="Close" style={{ flex: 'none', width: 44, height: 44, borderRadius: '50%', background: '#eeede7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: C.inkSoft }}>✕</Pressable>
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: isHq && task.why ? 12 : 18 }}>
        {isHq ? 'Planned by Claude' : isEmail ? 'Drafted from your inbox' : 'Drafted from your calendar'} · {task.meta}
      </div>

      {/* Claude's reasoning — every HQ task explains itself */}
      {isHq && task.why && (
        <div style={{ fontSize: 13, lineHeight: 1.5, color: C.inkSoft, background: '#f3f2ec', borderRadius: 12, padding: '10px 13px', marginBottom: 14 }}>
          <b style={{ fontWeight: 600 }}>Why:</b> {task.why}
        </div>
      )}
      {isHq && task.note && (
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: C.ink, marginBottom: 14 }}>{task.note}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <Pressable onPress={() => { day.toggleTask(task.id); onClose() }} style={{
          minHeight: 48, borderRadius: 15, background: task.done ? '#eeede7' : C.blue,
          color: task.done ? C.ink : '#fff', fontSize: 14.5, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: task.done ? 'none' : '0 8px 22px rgba(26,24,240,.3)',
        }}>{task.done ? 'Mark as not done' : 'Mark done'}</Pressable>

        {gmailUrl && (
          <Pressable onPress={() => openUrl(gmailUrl)} style={{
            minHeight: 48, borderRadius: 15, background: '#eceaf9', color: C.blue,
            fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>Open in Gmail</Pressable>
        )}

        {!task.done && (
          <Pressable onPress={() => {
            // HQ dismissal reports 'dismissed' upstream so Claude learns from it
            if (isHq) day.dismissHqTask(task.id)
            else day.toggleTask(task.id)
            onClose()
            onSnack?.({
              text: 'Dismissed', actionLabel: 'Undo',
              onAction: () => (isHq ? day.undoDismissHqTask(task.id) : day.toggleTask(task.id)),
            })
          }} style={{
            minHeight: 48, borderRadius: 15, background: C.card, color: C.inkSoft,
            fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(0,0,0,.05)',
          }}>Dismiss — not useful</Pressable>
        )}

        {isEmail && task.sender && day.signedIn && (
          <Pressable onPress={mute} style={{
            minHeight: 48, borderRadius: 15, background: 'transparent', color: C.red,
            fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{muting ? 'Muting…' : `Mute ${task.sender}`}</Pressable>
        )}
      </div>
    </div>
  )
}
