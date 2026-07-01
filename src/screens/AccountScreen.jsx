import { useState } from 'react'
import Pressable from '../components/Pressable.jsx'
import Toggle from '../components/Toggle.jsx'
import Avatar from '../components/Avatar.jsx'
import { C, FONT_SERIF, FONT_SANS } from '../theme.js'
import { signInWithGoogle } from '../lib/supabase.js'

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
  const {
    profile, settings, setSetting, feedMeta, generatedAt, refresh,
    signedIn, user, isPro, signOut, upgradeToPro,
  } = day
  const [upgradeNote, setUpgradeNote] = useState('')
  const headerTop = mobile ? 'calc(14px + env(safe-area-inset-top))' : '54px'

  // Prefer the feed profile; fall back to the auth user (e.g. before first feed build).
  const name = profile.name || user?.user_metadata?.full_name || user?.user_metadata?.name || 'Your name'
  const email = profile.email || user?.email || '—'
  const avatarUrl = profile.avatarUrl || user?.user_metadata?.avatar_url || null
  const needsReauth = !!feedMeta.needsReauth

  const status = feedMeta.demo
    ? { text: 'Demo data', color: C.muted }
    : feedMeta.stale
      ? { text: 'Offline — last saved', color: '#b06d0a' }
      : { text: 'Live', color: C.green }

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
        {signedIn ? (
          <>
            {/* profile */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '2px 4px 18px' }}>
              {avatarUrl
                ? <img src={avatarUrl} alt="" style={{ width: 60, height: 60, borderRadius: '50%', objectFit: 'cover' }} />
                : <Avatar size={60} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 22, lineHeight: 1, color: C.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                  <TierBadge pro={isPro} />
                </div>
                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
              </div>
            </div>

            {/* reconnect prompt */}
            {needsReauth && (
              <Pressable onPress={() => signInWithGoogle()} scale={0.99}
                style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 18px', padding: '12px 14px', borderRadius: 14, background: '#fdeee0', border: '1px solid #f3d9be', width: '100%', textAlign: 'left' }}>
                <span style={{ fontSize: 14 }}>⚠</span>
                <span style={{ flex: 1, fontSize: 12.5, color: '#7a4d12' }}>Google access expired — reconnect to keep your feed updating</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#b06d0a' }}>Reconnect ›</span>
              </Pressable>
            )}

            {/* data feed */}
            <SectionLabel>Data feed</SectionLabel>
            <Card>
              <Row
                title={<span style={{ color: status.color }}>{status.text}</span>}
                sub={'Updated ' + relativeTime(generatedAt)}
                action={<StatusDot color={status.color} />}
                border
              />
              <Pressable onPress={refresh} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                <Row title={<span style={{ color: C.blue }}>Refresh now</span>}
                  sub="Pull the latest feed" action={<Chevron color={C.blue} />} />
              </Pressable>
            </Card>

            {/* subscription */}
            <SectionLabel>Subscription</SectionLabel>
            <Card>
              <Row title="Plan" sub={isPro ? 'Pro — full brief + email tasks' : 'Free — calendar + tasks'}
                action={<TierBadge pro={isPro} />} border />
              {isPro ? (
                <Pressable onPress={() => {}} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                  <Row title="Manage subscription" sub="Billing & plan" action={<Chevron />} />
                </Pressable>
              ) : (
                <Pressable
                  onPress={async () => {
                    setUpgradeNote('')
                    const r = await upgradeToPro?.()
                    if (r?.status === 'pro') setUpgradeNote('You’re Pro — enjoy 🎉')
                    else if (r?.status === 'cancelled') setUpgradeNote('')
                    else if (r?.status === 'unavailable') setUpgradeNote('Subscriptions aren’t live yet — coming soon.')
                    else setUpgradeNote('Couldn’t start checkout. Try again.')
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                  <Row title={<span style={{ color: C.blue }}>Upgrade to Pro</span>}
                    sub={upgradeNote || 'Add the emails that need a reply + the AI brief'}
                    action={<Chevron color={C.blue} />} />
                </Pressable>
              )}
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

            {/* sign out */}
            <Pressable onPress={signOut}
              style={{ width: '100%', background: C.card, borderRadius: 16, padding: 15, textAlign: 'center', fontSize: 14.5, fontWeight: 600, color: C.red, boxShadow: '0 6px 20px rgba(0,0,0,.05)' }}>
              Sign out
            </Pressable>
          </>
        ) : (
          /* logged out */
          <div style={{ padding: '4px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '2px 0 22px' }}>
              <Avatar size={60} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 22, lineHeight: 1.1, color: C.ink }}>Sign in to WRK</div>
                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 5 }}>Connect Google to see your real day</div>
              </div>
            </div>

            <Pressable onPress={() => signInWithGoogle()} scale={0.98}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11, width: '100%', background: C.card, borderRadius: 16, padding: '15px', fontSize: 15, fontWeight: 600, color: C.ink, boxShadow: '0 6px 20px rgba(0,0,0,.06)' }}>
              <GoogleMark />
              <span>Continue with Google</span>
            </Pressable>

            <p style={{ fontSize: 12, lineHeight: 1.5, color: C.muted, margin: '16px 6px 0' }}>
              During the beta you may see a “Google hasn’t verified this app” screen — tap <b style={{ fontWeight: 600, color: C.inkSoft }}>Advanced → Continue</b>. That’s expected.
            </p>
          </div>
        )}

        <div style={{ height: mobile ? 'calc(140px + env(safe-area-inset-bottom))' : 130 }} />
      </main>
    </>
  )
}

function TierBadge({ pro }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 999, flex: 'none',
      color: pro ? '#fff' : C.inkSoft,
      background: pro ? C.blue : '#eceae4',
    }}>{pro ? 'Pro' : 'Free'}</span>
  )
}
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
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
function StatusDot({ color }) {
  return <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flex: 'none' }} />
}
function Chevron({ color }) {
  return <span style={{ fontSize: 16, color: color || C.faint, fontWeight: 600, lineHeight: 1 }}>›</span>
}
