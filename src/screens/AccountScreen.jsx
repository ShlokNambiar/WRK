import { useEffect, useState } from 'react'
import Pressable from '../components/Pressable.jsx'
import Toggle from '../components/Toggle.jsx'
import Avatar from '../components/Avatar.jsx'
import { C, FONT_SERIF, FONT_SANS } from '../theme.js'
import { signInWithGoogle } from '../lib/supabase.js'
import { listEmailRules, removeEmailRule } from '../lib/cloud.js'
import { restorePurchases, billingReady } from '../lib/billing.js'
import { openUrl } from '../lib/openUrl.js'
import { useMeasuredHeight } from '../hooks/useMeasuredHeight.js'

// GitHub Pages (repo Settings → Pages → main /docs). Play review rejects
// raw-repo blob links, so the policy is served as a real page.
const PRIVACY_URL = 'https://shloknambiar.github.io/WRK/PRIVACY.html'
const FEEDBACK_MAILTO = 'mailto:shlok@pepl.life?subject=WRK%20feedback'

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

// hours since the feed was generated (Infinity when unknown)
function ageHours(iso) {
  if (!iso) return Infinity
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 3600e3
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

export default function AccountScreen({ day, mobile, reduced, onSnack, onAsk }) {
  const {
    profile, settings, setSetting, feedMeta, generatedAt, rebuild, rebuilding,
    signedIn, user, isPro, signOut, upgradeToPro, notifStatus, enableNotifications,
    tokenSynced, removeAccount,
  } = day
  const [upgradeNote, setUpgradeNote] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [signInErr, setSignInErr] = useState('')
  const [rules, setRules] = useState(null) // null = not loaded, 'error' = load failed
  const [rulesRetry, setRulesRetry] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const headerTop = mobile ? 'calc(14px + env(safe-area-inset-top))' : '54px'
  const [headerRef, headerH] = useMeasuredHeight()

  // muted/allowed senders (the curation dial behind the email tasks).
  // A failed load must NOT render as "None yet" — that reads as "my mute
  // rules were deleted". It gets its own error row with a retry.
  useEffect(() => {
    if (!signedIn) { setRules(null); return }
    let on = true
    listEmailRules().then((r) => { if (on) setRules(r) }).catch(() => { if (on) setRules('error') })
    return () => { on = false }
  }, [signedIn, rulesRetry])

  // Sign-in / reconnect with real feedback: on web the page redirects (so we
  // leave the spinner on); on error/cancel we surface a message and re-enable.
  const handleSignIn = async () => {
    if (signingIn) return
    setSigningIn(true)
    setSignInErr('')
    try {
      const { error } = (await signInWithGoogle()) || {}
      if (error) { setSignInErr("Couldn't start Google sign-in. Try again."); setSigningIn(false) }
    } catch {
      setSignInErr("Couldn't start Google sign-in. Try again."); setSigningIn(false)
    }
  }

  // On native there is no redirect — the Custom Tab opens over the app. If the
  // user backs out of it without completing OAuth, no auth event ever fires, so
  // the "Connecting…" spinner used to stick (disabled button) until a force
  // restart. When the app regains focus with no session, re-enable after a
  // grace period (the deep-link exchange, when it IS coming, lands well inside it).
  useEffect(() => {
    if (!signingIn) return
    if (signedIn) { setSigningIn(false); return }
    let t = null
    const onBack = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(t)
      t = setTimeout(() => setSigningIn(false), 4000)
    }
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('focus', onBack)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', onBack)
      window.removeEventListener('focus', onBack)
    }
  }, [signingIn, signedIn])

  const confirmSignOut = () => {
    onAsk?.({
      title: 'Sign out?',
      body: 'Your feed stops updating on this device. Your tasks are backed up to your account.',
      confirmLabel: 'Sign out', tone: 'red',
      onConfirm: signOut,
    })
  }

  const doRefresh = async () => {
    const r = await rebuild()
    if (r === 'built') onSnack?.({ text: 'Feed rebuilt — fresh as of now' })
    else if (r === 'rate_limited') onSnack?.({ text: 'Just rebuilt — try again in a few minutes' })
    else if (r === 'error' && signedIn) onSnack?.({ text: "Couldn't rebuild — showing the last saved feed" })
  }

  // Prefer the feed profile; fall back to the auth user (e.g. before first feed build).
  const name = profile.name || user?.user_metadata?.full_name || user?.user_metadata?.name || 'Your name'
  const email = profile.email || user?.email || '—'
  const avatarUrl = profile.avatarUrl || user?.user_metadata?.avatar_url || null
  const needsReauth = !!feedMeta.needsReauth

  // "Live" has a freshness threshold — a feed that missed today's build slot
  // (>26h old) must not wear a green dot for another four hours.
  const hrs = ageHours(generatedAt)
  const status = feedMeta.pending
    ? { text: 'Preparing your feed', color: '#b06d0a' }
    : feedMeta.demo
      ? { text: 'Demo data', color: C.muted }
      : feedMeta.stale
        ? { text: 'Offline — last saved', color: '#b06d0a' }
        : hrs > 26
          ? { text: 'Out of date', color: C.red }
          : { text: 'Live', color: C.green }
  const updatedSub = feedMeta.pending
    ? 'Waiting for your first brief'
    : feedMeta.demo
      ? 'Not connected yet'
      : 'Updated ' + relativeTime(generatedAt)

  return (
    <>
      <header ref={headerRef} style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, padding: `${headerTop} 22px 10px`,
        background: 'linear-gradient(180deg,rgba(247,247,244,.96),rgba(247,247,244,0))',
      }}>
        <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 36, lineHeight: 1, letterSpacing: '-.015em', margin: 0, color: C.ink }}>Account</h1>
      </header>

      <main className="wrk-scroll" style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        top: headerH || (mobile ? 'calc(96px + env(safe-area-inset-top))' : 104),
        overflowY: 'auto', padding: '0 18px 0',
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

            {/* first-consent token sync failed: the backend never got the
                Google token, so no feed will EVER build. A fresh sign-in
                re-mints the refresh token (prompt=consent) and self-heals. */}
            {!needsReauth && feedMeta.pending && !tokenSynced && (
              <Pressable onPress={handleSignIn} scale={0.99}
                style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 18px', padding: '12px 14px', borderRadius: 14, background: '#fdeee0', border: '1px solid #f3d9be', width: '100%', textAlign: 'left' }}>
                <span style={{ fontSize: 14 }}>⚠</span>
                <span style={{ flex: 1, fontSize: 12.5, color: '#7a4d12' }}>Setup didn’t finish — reconnect Google so your feed can build</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#b06d0a' }}>{signingIn ? 'Connecting…' : 'Reconnect ›'}</span>
              </Pressable>
            )}

            {/* reconnect prompt */}
            {needsReauth && (
              <Pressable onPress={handleSignIn} scale={0.99}
                style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 18px', padding: '12px 14px', borderRadius: 14, background: '#fdeee0', border: '1px solid #f3d9be', width: '100%', textAlign: 'left' }}>
                <span style={{ fontSize: 14 }}>⚠</span>
                <span style={{ flex: 1, fontSize: 12.5, color: '#7a4d12' }}>Google access expired — reconnect to keep your feed updating</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#b06d0a' }}>{signingIn ? 'Connecting…' : 'Reconnect ›'}</span>
              </Pressable>
            )}

            {/* data feed */}
            <SectionLabel>Data feed</SectionLabel>
            <Card>
              <Row
                title={<span style={{ color: status.color }}>{status.text}</span>}
                sub={updatedSub}
                action={<StatusDot color={status.color} />}
                border
              />
              <Pressable onPress={doRefresh} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                <Row title={<span style={{ color: C.blue }}>{rebuilding ? 'Rebuilding…' : 'Refresh now'}</span>}
                  sub={rebuilding ? 'Fetching your calendar & inbox' : 'Rebuild your feed from Google, right now'} action={<Chevron color={C.blue} />} />
              </Pressable>
            </Card>

            {/* daily brief */}
            <SectionLabel>Daily brief</SectionLabel>
            <Card>
              <Row title="Morning brief time" sub="When your feed is built & you're pinged"
                action={
                  <input type="time" value={to24h(settings.briefTime)}
                    onChange={(e) => e.target.value && setSetting('briefTime', to12h(e.target.value))}
                    aria-label="Morning brief time"
                    style={{
                      fontFamily: FONT_SANS, fontSize: 13, fontWeight: 600, color: C.blue,
                      background: '#eceaf9', border: 'none', borderRadius: 11, padding: '0 12px',
                      minHeight: 44, outline: 'none', appearance: 'none', WebkitAppearance: 'none',
                    }} />
                }
                border />
              {notifStatus !== 'granted' && notifStatus !== 'unavailable' && (
                <Pressable onPress={enableNotifications} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                  <Row title={<span style={{ color: C.blue }}>Turn on notifications</span>}
                    sub={notifStatus === 'denied' ? 'Blocked — enable WRK in Android Settings' : 'One ping when your brief is ready'}
                    action={<Chevron color={C.blue} />} border />
                </Pressable>
              )}
              {/* Two honest switches: the old single "Auto-draft tasks from
                  email" toggle actually gated CALENDAR suggestions — a consent
                  control that lied. Email tasks now have their own switch,
                  enforced server-side (build-feed skips Gmail entirely). */}
              <Row title="Suggest tasks from calendar" sub="Prep nudges for invites & RSVPs"
                action={<Toggle on={settings.autoDraft} onChange={(v) => setSetting('autoDraft', v)} reduced={reduced} />}
                border={isPro} />
              {isPro && (
                <Row title="Email tasks" sub="Turn emails that need a reply into tasks"
                  action={<Toggle on={settings.emailTasks !== false} onChange={(v) => setSetting('emailTasks', v)} reduced={reduced} />} />
              )}
            </Card>

            {/* sender curation */}
            {isPro && (
              <>
                <SectionLabel>Email senders</SectionLabel>
                <Card>
                  {rules === null && <Row title="Muted senders" sub="Loading…" />}
                  {rules === 'error' && (
                    <Pressable onPress={() => { setRules(null); setRulesRetry((n) => n + 1) }}
                      style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                      <Row title="Muted senders" sub="Couldn’t load — tap to retry"
                        action={<Chevron color={C.blue} />} />
                    </Pressable>
                  )}
                  {Array.isArray(rules) && rules.length === 0 && (
                    <Row title="Muted senders" sub="None yet — mute one from any email task" />
                  )}
                  {(Array.isArray(rules) ? rules : []).map((r, i) => (
                    <Row key={r.sender}
                      title={<span style={{ fontSize: 13.5 }}>{r.sender}</span>}
                      sub={r.mode === 'mute' ? 'Muted — never becomes a task' : 'Always allowed'}
                      action={
                        <Pressable
                          onPress={async () => {
                            try {
                              await removeEmailRule(r.sender)
                              setRules((rs) => rs.filter((x) => x.sender !== r.sender))
                              onSnack?.({ text: `Removed rule for ${r.sender}` })
                            } catch { onSnack?.({ text: "Couldn't remove — try again" }) }
                          }}
                          ariaLabel={`Remove rule for ${r.sender}`}
                          style={{ fontSize: 12.5, fontWeight: 600, color: C.red, padding: '10px 6px', flex: 'none' }}
                        >Remove</Pressable>
                      }
                      border={i < rules.length - 1} />
                  ))}
                </Card>
              </>
            )}

            {/* subscription */}
            <SectionLabel>Subscription</SectionLabel>
            <Card>
              <Row title="Plan"
                sub={isPro ? 'Pro — full brief + email tasks · free during beta' : 'Free — calendar + tasks'}
                action={<TierBadge pro={isPro} />} border />
              {isPro ? (
                <>
                  <Pressable
                    onPress={() => openUrl('https://play.google.com/store/account/subscriptions')}
                    style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                    <Row title="Manage subscription" sub="Billing & plan · opens Google Play" action={<Chevron />} border />
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      const r = await restorePurchases()
                      onSnack?.({
                        text: r.status === 'pro' ? 'Pro restored 🎉'
                          : r.status === 'unavailable' ? 'Nothing to restore yet — billing opens after beta'
                            : r.status === 'free' ? 'No active subscription found' : "Couldn't reach the store",
                      })
                    }}
                    style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                    <Row title="Restore purchases" sub="Bought Pro on another device?" action={<Chevron />} />
                  </Pressable>
                </>
              ) : billingReady() ? (
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
              ) : (
                /* billing not wired yet: an "Upgrade" that dead-ends in
                   "coming soon" is a broken promise, not a CTA */
                <Row title="Pro is free during beta"
                  sub="Email tasks + the AI brief — billing opens after beta" />
              )}
            </Card>

            <AboutCard onSnack={onSnack} />

            {/* sign out — confirmed, because one stray tap used to nuke the session */}
            <Pressable onPress={confirmSignOut}
              style={{ width: '100%', background: C.card, borderRadius: 16, padding: 15, textAlign: 'center', fontSize: 14.5, fontWeight: 600, color: C.red, boxShadow: '0 6px 20px rgba(0,0,0,.05)' }}>
              Sign out
            </Pressable>

            {/* account deletion — Play requires an in-app path. Double-confirmed:
                the second dialog spells out exactly what is destroyed. */}
            <Pressable
              onPress={() => {
                if (deleting) return
                onAsk?.({
                  title: 'Delete your account?',
                  body: 'This permanently erases your WRK account and everything in it.',
                  confirmLabel: 'Continue', tone: 'red',
                  onConfirm: () => setTimeout(() => onAsk?.({
                    title: 'This can’t be undone',
                    body: 'Your feed, task backup, email rules and Google connection are deleted from our servers immediately. Your Google account itself is untouched.',
                    confirmLabel: 'Delete everything', tone: 'red',
                    onConfirm: async () => {
                      setDeleting(true)
                      const r = await removeAccount()
                      setDeleting(false)
                      onSnack?.({
                        text: r === 'deleted'
                          ? 'Account deleted — thanks for trying WRK'
                          : 'Couldn’t delete right now — check your connection and try again',
                      })
                    },
                  }), 150),
                })
              }}
              style={{ width: '100%', marginTop: 12, background: 'transparent', borderRadius: 16, padding: 13, textAlign: 'center', fontSize: 13, fontWeight: 600, color: C.muted, minHeight: 44 }}>
              {deleting ? 'Deleting…' : 'Delete account & data'}
            </Pressable>
          </>
        ) : (
          /* logged out */
          <div style={{ padding: '4px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '2px 0 18px' }}>
              <Avatar size={60} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 22, lineHeight: 1.1, color: C.ink }}>Sign in to WRK</div>
                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 5 }}>Your day, auto-assembled every morning</div>
              </div>
            </div>

            {/* what we access & why — trust before the consent screen, not after */}
            <div style={{ background: C.card, borderRadius: 16, padding: '14px 16px', boxShadow: '0 6px 20px rgba(0,0,0,.05)', marginBottom: 14 }}>
              <TrustLine icon="📅" text={<><b style={{ fontWeight: 600 }}>Calendar · read-only.</b> Builds your daily schedule & brief.</>} />
              <TrustLine icon="✉️" text={<><b style={{ fontWeight: 600 }}>Gmail · read-only.</b> Finds emails that need a reply and drafts them as tasks. Only subject + sender are processed; bodies are never stored.</>} />
              <TrustLine icon="🔒" text={<>WRK can’t send, delete, or change anything in your account.</>} last />
            </div>

            <Pressable onPress={handleSignIn} scale={0.98} disabled={signingIn}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11, width: '100%', background: C.card, borderRadius: 16, padding: '15px', fontSize: 15, fontWeight: 600, color: C.ink, boxShadow: '0 6px 20px rgba(0,0,0,.06)', opacity: signingIn ? 0.6 : 1 }}>
              <GoogleMark />
              <span>{signingIn ? 'Connecting…' : 'Continue with Google'}</span>
            </Pressable>
            {signInErr && <p style={{ fontSize: 12.5, color: C.red, margin: '10px 6px 0' }}>{signInErr}</p>}

            <p style={{ fontSize: 12, lineHeight: 1.5, color: C.muted, margin: '14px 6px 0' }}>
              During the beta you may see a “Google hasn’t verified this app” screen — tap <b style={{ fontWeight: 600, color: C.inkSoft }}>Advanced → Continue</b>. That’s expected while our verification is in review.
            </p>
            <p style={{ fontSize: 12, margin: '10px 6px 0' }}>
              <Pressable onPress={() => openUrl(PRIVACY_URL)} style={{ color: C.blue, fontWeight: 600, fontSize: 12, padding: '8px 0' }}>Read the privacy policy ›</Pressable>
            </p>

            <div style={{ marginTop: 20 }}>
              <AboutCard onSnack={onSnack} />
            </div>
          </div>
        )}

        <div style={{ height: mobile ? 'calc(140px + env(safe-area-inset-bottom))' : 130 }} />
      </main>
    </>
  )
}

// About / help — privacy, feedback, version. Play requires the policy IN app.
function AboutCard({ onSnack }) {
  return (
    <>
      <SectionLabel>About</SectionLabel>
      <Card>
        <Pressable onPress={() => openUrl(PRIVACY_URL)} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
          <Row title="Privacy policy" sub="What we read, what we never store" action={<Chevron />} border />
        </Pressable>
        <Pressable onPress={() => openUrl(FEEDBACK_MAILTO)} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
          <Row title="Send feedback" sub="Beta bugs & ideas — straight to the maker" action={<Chevron />} border />
        </Pressable>
        <Row title="Version" sub="WRK beta" action={<span style={{ fontSize: 12, color: C.faint }}>1.0.0</span>} />
      </Card>
    </>
  )
}

function TrustLine({ icon, text, last }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingBottom: last ? 0 : 11, marginBottom: last ? 0 : 11, borderBottom: last ? 'none' : '1px solid #f3f2ec' }}>
      <span aria-hidden="true" style={{ fontSize: 14, flex: 'none', marginTop: 1 }}>{icon}</span>
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: C.inkSoft }}>{text}</span>
    </div>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 15px', borderBottom: border ? '1px solid #f3f2ec' : 'none', minHeight: 52 }}>
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
