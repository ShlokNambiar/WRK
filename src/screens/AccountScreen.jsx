import { useState } from 'react'
import Pressable from '../components/Pressable.jsx'
import Toggle from '../components/Toggle.jsx'
import Avatar from '../components/Avatar.jsx'
import { C, FONT_SERIF, FONT_SANS } from '../theme.js'
import { getFeedUrl, getFeedKey, setFeedUrl, setFeedKey } from '../lib/feedConfig.js'

function relativeTime(iso) {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never'
  const diff = Date.now() - then
  if (diff < 60 * 1000) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return mins + 'm ago'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return hrs + 'h ago'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// '7:00 AM' -> '07:00'
function to24h(label) {
  if (!label) return '07:00'
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(label.trim())
  if (!m) return '07:00'
  let h = parseInt(m[1], 10)
  const min = m[2]
  const ap = (m[3] || '').toUpperCase()
  if (ap === 'PM' && h < 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return String(h).padStart(2, '0') + ':' + min
}

// '07:00' -> '7:00 AM'
function to12h(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '')
  if (!m) return '7:00 AM'
  let h = parseInt(m[1], 10)
  const min = m[2]
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return h + ':' + min + ' ' + ap
}

export default function AccountScreen({ day, mobile, reduced }) {
  const { profile, settings, setSetting, feedMeta, feedConfigured, generatedAt, refresh, disconnect } = day
  const headerTop = mobile ? 'calc(14px + env(safe-area-inset-top))' : '54px'

  // which feed row is open for inline editing + its draft text
  const [editing, setEditing] = useState(null) // 'url' | 'key' | null
  const [draft, setDraft] = useState('')

  const openEdit = (which) => {
    setEditing(which)
    setDraft(which === 'url' ? (getFeedUrl() || '') : (getFeedKey() || ''))
  }
  const commit = () => {
    if (editing === 'url') setFeedUrl(draft.trim())
    else if (editing === 'key') setFeedKey(draft.trim())
    setEditing(null)
    refresh()
  }
  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
    else if (e.key === 'Escape') { setEditing(null) }
  }

  const status = feedMeta.demo
    ? { text: 'Demo data', color: C.muted }
    : feedMeta.stale
      ? { text: 'Offline — last saved', color: '#b06d0a' }
      : { text: 'Live', color: C.green }

  const feedUrl = getFeedUrl()
  const feedKey = getFeedKey()

  return (
    <>
      <header style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, padding: `${headerTop} 22px 10px`,
        background: 'linear-gradient(180deg,rgba(247,247,244,.96),rgba(247,247,244,0))',
      }}>
        <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 36, lineHeight: 1, letterSpacing: '-.015em', margin: 0, color: C.ink }}>Account</h1>
      </header>

      <main className="wrk-scroll" style={{
        position: 'absolute', inset: 0, overflowY: 'auto',
        padding: mobile ? 'calc(96px + env(safe-area-inset-top)) 18px 0' : '104px 18px 0',
      }}>
        {/* profile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '2px 4px 18px' }}>
          {profile.avatarUrl
            ? <img src={profile.avatarUrl} alt="" style={{ width: 60, height: 60, borderRadius: '50%', objectFit: 'cover' }} />
            : <Avatar size={60} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 22, lineHeight: 1, color: C.ink }}>{profile.name || 'Your name'}</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>{profile.email || '—'}</div>
          </div>
        </div>

        {/* data feed */}
        <SectionLabel>Data feed</SectionLabel>
        <Card>
          <Row
            title={<span style={{ color: status.color }}>{status.text}</span>}
            sub={'Updated ' + relativeTime(generatedAt)}
            action={<StatusDot color={status.color} />}
            border
          />

          {editing === 'url' ? (
            <EditRow value={draft} onChange={setDraft} onBlur={commit} onKeyDown={onKeyDown}
              placeholder="https://…/rest/v1/feeds?select=payload" autoFocus />
          ) : (
            <Pressable onPress={() => openEdit('url')} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
              <Row title="Feed URL" sub={feedUrl || 'Not set — tap to add'} action={<Chevron />} border />
            </Pressable>
          )}

          {editing === 'key' ? (
            <EditRow value={draft} onChange={setDraft} onBlur={commit} onKeyDown={onKeyDown}
              placeholder="anon / service key" autoFocus />
          ) : (
            <Pressable onPress={() => openEdit('key')} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
              <Row title="Access key" sub={feedKey ? '••••' : 'Not set — tap to add'} action={<Chevron />} border />
            </Pressable>
          )}

          <Pressable onPress={refresh} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
            <Row title={<span style={{ color: C.blue }}>Refresh now</span>}
              sub="Pull the latest feed" action={<Chevron color={C.blue} />} />
          </Pressable>
        </Card>

        {/* daily brief */}
        <SectionLabel>Daily brief</SectionLabel>
        <Card>
          <Row title="Morning brief time" sub="Delivered before you wake"
            action={
              <input type="time" value={to24h(settings.briefTime)}
                onChange={(e) => e.target.value && setSetting('briefTime', to12h(e.target.value))}
                style={{
                  fontFamily: FONT_SANS, fontSize: 13, fontWeight: 600, color: C.blue,
                  background: '#eceaf9', border: 'none', borderRadius: 11, padding: '5px 11px',
                  outline: 'none', appearance: 'none', WebkitAppearance: 'none',
                }} />
            }
            border />
          <Row title="Auto-draft tasks from email" sub="Let WRK suggest to-dos"
            action={<Toggle on={settings.autoDraft} onChange={(v) => setSetting('autoDraft', v)} reduced={reduced} />} />
        </Card>

        {/* reset */}
        {feedConfigured ? (
          <Pressable onPress={disconnect}
            style={{ width: '100%', background: C.card, borderRadius: 16, padding: 15, textAlign: 'center', fontSize: 14.5, fontWeight: 600, color: C.red, boxShadow: '0 6px 20px rgba(0,0,0,.05)' }}>
            Reset feed
          </Pressable>
        ) : (
          <div style={{ width: '100%', background: C.card, borderRadius: 16, padding: 15, textAlign: 'center', fontSize: 14.5, fontWeight: 600, color: C.faint, boxShadow: '0 6px 20px rgba(0,0,0,.05)' }}>
            No feed configured
          </div>
        )}

        <div style={{ height: mobile ? 'calc(140px + env(safe-area-inset-bottom))' : 130 }} />
      </main>
    </>
  )
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, padding: '0 4px 9px' }}>{children}</div>
}
function Card({ children }) {
  return <div style={{ background: C.card, borderRadius: 16, overflow: 'hidden', boxShadow: '0 6px 20px rgba(0,0,0,.05)', marginBottom: 22 }}>{children}</div>
}
function Row({ icon, title, sub, action, border }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 15px', borderBottom: border ? '1px solid #f3f2ec' : 'none' }}>
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT_SANS }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
      </div>
      {action}
    </div>
  )
}
function EditRow({ value, onChange, onBlur, onKeyDown, placeholder, autoFocus }) {
  return (
    <div style={{ padding: '11px 15px', borderBottom: '1px solid #f3f2ec' }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        style={{
          width: '100%', boxSizing: 'border-box', fontFamily: FONT_SANS, fontSize: 13.5,
          color: C.ink, background: C.paper, border: '1px solid ' + C.line, borderRadius: 10,
          padding: '9px 11px', outline: 'none',
        }}
      />
    </div>
  )
}
function StatusDot({ color }) {
  return <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flex: 'none' }} />
}
function Chevron({ color }) {
  return <span style={{ fontSize: 16, color: color || C.faint, fontWeight: 600, lineHeight: 1 }}>›</span>
}
