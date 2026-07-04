import { Fragment } from 'react'
import { motion } from 'framer-motion'
import Avatar from '../components/Avatar.jsx'
import Pressable from '../components/Pressable.jsx'
import TaskRow from '../components/TaskRow.jsx'
import TimelineEvent from '../components/TimelineEvent.jsx'
import NowMarker from '../components/NowMarker.jsx'
import { s } from '../style.js'
import { useMeasuredHeight } from '../hooks/useMeasuredHeight.js'
import { C, FONT_SERIF, FONT_SANS, SPRING } from '../theme.js'

export default function HomeScreen({ day, mobile, reduced, onAddTask, goToAccount, openEdit, openTaskDetail, openEventDetail }) {
  const {
    greeting, brief, briefFromToday, timeline, todayTimeline, tasks, nowLabel, toggleTask,
    profile, feedMeta, loading, isPro, signedIn, notifStatus, enableNotifications, generatedAt,
  } = day
  const demo = feedMeta?.demo
  const pending = feedMeta?.pending // signed in, first feed not built yet
  const needsReauth = feedMeta?.needsReauth
  const [headerRef, headerH] = useMeasuredHeight()
  const headerTop = mobile ? 'calc(14px + env(safe-area-inset-top))' : '54px'
  // Home is ALWAYS today, even if the Calendar tab is browsing another day
  const tl = todayTimeline || timeline
  const nowIndex = tl.findIndex((e) => !e.isPast)
  const openTasks = tasks.filter((t) => !t.done).slice(0, 4)

  // when was the brief built? ("6:32 am" when fresh; the template fallback is live)
  const briefStamp = briefFromToday && generatedAt
    ? new Date(generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase()
    : null

  return (
    <>
      {/* header */}
      <header ref={headerRef} style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
        padding: `${headerTop} 22px 12px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(180deg,rgba(247,247,244,.95),rgba(247,247,244,0))',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      }}>
        <Pressable onPress={goToAccount} ariaLabel="Account" style={{ borderRadius: '50%' }}>
          {profile.avatarUrl
            ? <img src={profile.avatarUrl} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 2px 10px rgba(0,0,0,.12)', display: 'block' }} />
            : <Avatar size={36} />}
        </Pressable>
        <div style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 23, color: C.ink, letterSpacing: '.06em' }}>WRK</div>
        {/* right side balances the avatar; the old bell was a decoy control */}
        <div aria-hidden="true" style={{ width: 36, height: 36 }} />
      </header>

      {/* scroller */}
      <main className="wrk-scroll" style={{ ...scroller(mobile), top: headerH || scroller(mobile).top }}>
        {/* demo-data banner (logged out / no feed configured) */}
        {demo && (
          <Pressable onPress={goToAccount} scale={0.99}
            style={s('display:flex;align-items:center;gap:10px;margin:0 22px;padding:10px 13px;border-radius:14px;background:#eceaf9;border:1px solid #ddd9f7;width:calc(100% - 44px)')}>
            <span style={{ fontSize: 14, color: C.blue }}>✦</span>
            <span style={{ flex: 1, fontSize: 12.5, color: '#3a3a44', textAlign: 'left' }}>Showing <b style={{ fontWeight: 600 }}>sample data</b> for “Alex” — set up your feed to see your day</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.blue }}>Set up ›</span>
          </Pressable>
        )}
        {/* signed in, first feed still building */}
        {pending && !needsReauth && (
          <div style={s('display:flex;align-items:center;gap:10px;margin:0 22px;padding:10px 13px;border-radius:14px;background:#eceaf9;border:1px solid #ddd9f7;width:calc(100% - 44px)')}>
            <span style={{ fontSize: 14, color: C.blue }}>✦</span>
            <span style={{ flex: 1, fontSize: 12.5, color: '#3a3a44', textAlign: 'left' }}>Your first brief is being prepared — or build it now from Account → Refresh</span>
          </div>
        )}
        {/* Google token died — the daily screen must say so, not just Account */}
        {needsReauth && (
          <Pressable onPress={goToAccount} scale={0.99}
            style={s('display:flex;align-items:center;gap:10px;margin:0 22px;padding:10px 13px;border-radius:14px;background:#fdeee0;border:1px solid #f3d9be;width:calc(100% - 44px)')}>
            <span style={{ fontSize: 14 }}>⚠</span>
            <span style={{ flex: 1, fontSize: 12.5, color: '#7a4d12', textAlign: 'left' }}>Google access expired — your feed stopped updating</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#b06d0a' }}>Reconnect ›</span>
          </Pressable>
        )}

        {/* greeting */}
        <motion.div initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} style={{ padding: '8px 22px 4px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted, fontFamily: FONT_SANS }}>{greeting.dateLabel}</div>
          <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 38, lineHeight: 1.04, letterSpacing: '-.015em', color: C.ink, margin: '8px 0 0' }}>{greeting.greeting},<br />{greeting.name}</h1>
        </motion.div>

        {/* daily brief */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...SPRING, delay: reduced ? 0 : 0.04 }}
          style={{ position: 'relative', margin: '18px 22px 4px', borderRadius: 26, overflow: 'hidden', background: C.blue, color: '#fff', padding: '20px 20px 18px', boxShadow: '0 16px 38px rgba(26,24,240,.28)' }}
        >
          <span aria-hidden="true" style={s('position:absolute;top:-44px;right:-30px;width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,.10)')} />
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.85)' }}>✦ Daily Brief</div>
              {briefStamp && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', flex: 'none' }}>built {briefStamp}</div>}
            </div>
            <p style={{ fontFamily: FONT_SERIF, fontSize: 20, lineHeight: 1.42, margin: '12px 0 0' }}>
              {brief.runs.map((r, i) => r.emph ? <Emph key={i}>{r.text}</Emph> : <span key={i}>{r.text}</span>)}
            </p>
            <div style={{ display: 'flex', gap: 9, marginTop: 16 }}>
              {brief.stats.map((st, i) => <Stat key={i} n={st.n} label={st.label} />)}
            </div>
          </div>
        </motion.div>

        {/* notification priming — asked in context, never as a cold boot dialog */}
        {signedIn && notifStatus === 'prompt' && (
          <div style={{ margin: '14px 22px 0' }}>
            <Pressable onPress={enableNotifications} scale={0.99}
              style={s('display:flex;align-items:center;gap:12px;padding:13px 14px;border-radius:16px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.05);width:100%;text-align:left')}>
              <span style={s('flex:none;width:30px;height:30px;border-radius:9px;background:#eceaf9;color:#1a18f0;display:flex;align-items:center;justify-content:center;font-size:15px')}>🔔</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: C.ink }}>Get your brief each morning</span>
                <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2 }}>One notification when your day is ready</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.blue, flex: 'none' }}>Turn on ›</span>
            </Pressable>
          </div>
        )}

        {/* Today timeline */}
        <section style={{ padding: '26px 22px 0' }} aria-label="Today's schedule">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 24, margin: 0, color: C.ink }}>Today</h2>
          </div>
          <div>
            {tl.map((ev, i) => (
              <Fragment key={ev.id}>
                {i === nowIndex && <NowMarker label={nowLabel} />}
                <TimelineEvent ev={ev} isLast={i === tl.length - 1} reduced={reduced} onOpen={openEventDetail} />
              </Fragment>
            ))}
            {tl.length === 0 && !loading && <Empty text={pending ? 'Your schedule appears here after your first brief.' : 'Nothing on your calendar today.'} />}
          </div>
        </section>

        {/* Tasks preview */}
        <section style={{ padding: '30px 22px 0' }} aria-label="Tasks">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 24, margin: 0, color: C.ink }}>Tasks</h2>
            <span style={{ fontSize: 12.5, color: C.faint, fontFamily: FONT_SANS }}>{tasks.filter((t) => !t.done).length} open</span>
          </div>
          <p style={{ fontSize: 12.5, color: C.muted, margin: '6px 0 0' }}>
            <span style={{ color: C.blue }}>✦</span>{demo ? ' Sample tasks — set up your feed' : pending ? ' Your tasks appear here after your first brief' : isPro ? ' Auto-drafted from your inbox & calendar' : ' Auto-drafted from your calendar'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 14 }}>
            {!isPro && (
              <Pressable onPress={goToAccount} scale={0.99}
                style={s('display:flex;align-items:center;gap:12px;padding:14px;border-radius:18px;background:#eceaf9;border:1px solid #ddd9f7;width:100%;text-align:left')}>
                <span style={s('flex:none;width:30px;height:30px;border-radius:9px;background:#1a18f0;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px')}>✦</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: C.ink }}>Upgrade to Pro</span>
                  <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2 }}>See the emails that need a reply</span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.blue, flex: 'none' }}>Upgrade ›</span>
              </Pressable>
            )}
            {openTasks.map((t) => <TaskRow key={t.id} task={t} onToggle={toggleTask} onEdit={openEdit} onDetail={openTaskDetail} reduced={reduced} />)}
            <Pressable ariaLabel="Add a task" onPress={onAddTask} scale={0.985}
              style={s('display:flex;align-items:center;gap:13px;padding:13px;border-radius:18px;border:2px dashed #d8d7cf;background:transparent;width:100%')}>
              <span style={s('flex:none;width:24px;height:24px;border-radius:7px;background:#eceaf9;display:flex;align-items:center;justify-content:center;font-size:17px;line-height:1;color:#1a18f0;font-weight:300')}>+</span>
              <span style={{ fontSize: 15, color: C.muted }}>Add a task…</span>
            </Pressable>
          </div>
        </section>

        <div style={{ height: mobile ? 'calc(140px + env(safe-area-inset-bottom))' : 130 }} />
      </main>
    </>
  )
}

export function scroller(mobile) {
  return {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    top: mobile ? 'calc(92px + env(safe-area-inset-top))' : 96,
    overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch',
  }
}
export function Empty({ text }) {
  return <div style={{ color: C.muted, fontSize: 14, padding: '8px 2px' }}>{text}</div>
}
function Emph({ children }) {
  return <span style={{ fontWeight: 600, boxShadow: 'inset 0 -0.4em 0 rgba(255,255,255,.18)' }}>{children}</span>
}
function Stat({ n, label }) {
  return (
    <div style={{ flex: 1, background: 'rgba(255,255,255,.14)', borderRadius: 14, padding: '10px 12px' }}>
      <div style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 22, lineHeight: 1, color: '#fff' }}>{n}</div>
      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.8)', marginTop: 4 }}>{label}</div>
    </div>
  )
}
