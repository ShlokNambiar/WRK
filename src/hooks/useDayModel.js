// Assembles the whole app from a single JSON feed (produced by the build-feed
// edge function). Owns manual tasks, done-state, brief settings, and the
// selected calendar day. Persisted locally per-account; offline-first, with a
// debounced cloud backup so a reinstall restores tasks.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getFeed, normalizeDay, isoDate } from '../providers/feed.js'
import { loadState, saveState, clearState } from '../lib/storage.js'
import { clearCache } from '../lib/feedConfig.js'
import { getSession, onAuthChange, signOut } from '../lib/supabase.js'
import { syncProviderToken, tokenSyncOk, markTokenSynced, clearTokenSynced } from '../lib/syncToken.js'
import {
  syncProfilePrefs, pushTaskState, pullTaskState, rebuildFeed,
  setHqTaskStatus, deleteAccount as cloudDeleteAccount,
} from '../lib/cloud.js'
import { getTier } from '../providers/entitlement.js'
import { initBilling, purchasePro } from '../lib/billing.js'
import {
  notificationStatus, requestNotifications, scheduleDailyBrief,
  scheduleTaskReminder, cancelTaskReminder, cancelAll,
} from '../lib/notifications.js'
import {
  buildTimeline, deriveAutoTasks, buildBrief, buildGreeting, mergeTasks, groupTasks,
  liveStats, dueLabel, fmtTime,
} from '../lib/derive.js'

// emailTasks mirrors profiles.email_tasks_enabled server-side — build-feed
// skips the Gmail fetch entirely when it's off (a real consent switch, not a
// client-side hide).
const DEFAULT_SETTINGS = { briefTime: '7:00 AM', autoDraft: true, emailTasks: true }

// How long a deletion tombstone (and off-day auto/email done-state) is kept.
const RETENTION = 30 * 864e5

// Legacy tasks stored their note in `meta` (colliding with system strings like
// "added just now"); migrate it into a dedicated `note` field once. Tasks from
// before edit-stamping get updatedAt 0 so any tombstone beats them.
function migrateTask(t) {
  const stamped = t.updatedAt === undefined ? { ...t, updatedAt: 0 } : t
  if (stamped.note !== undefined) return stamped
  const isSystemMeta = !stamped.meta || /^(added|from)/i.test(stamped.meta)
  return { ...stamped, note: isSystemMeta ? '' : stamped.meta, meta: isSystemMeta ? stamped.meta : 'added earlier' }
}

// Union two task lists by id, local first (local edits win over the backup),
// then honor deletion tombstones: without them, a task deleted on device A
// ping-pongs back forever via device B's copy of the old list. A task edited or
// restored AFTER its tombstone (updatedAt newer) survives — that's what Undo is.
function mergeTaskLists(local, remote, tombstones = {}) {
  const seen = new Set(local.map((t) => t.id))
  const union = [...local, ...(remote || []).filter((t) => !seen.has(t.id))]
  return union.filter((t) => {
    const deadAt = tombstones[t.id]
    return !deadAt || (t.updatedAt || 0) > deadAt
  })
}

export function useDayModel() {
  const [now, setNow] = useState(() => new Date())
  const [feed, setFeed] = useState(null)
  // demo:false until the first fetch resolves — otherwise signed-in users get a
  // one-beat flash of the "sample data for Alex" banner on every cold start.
  const [meta, setMeta] = useState({ demo: false, stale: false, error: false, needsReauth: false })
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(() => isoDate(new Date()))

  // auth + entitlement
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [tier, setTier] = useState('free')
  const [tokenSynced, setTokenSynced] = useState(() => tokenSyncOk())
  const [wantBuild, setWantBuild] = useState(0) // bumped after a fresh consent stores a token

  // user-owned state (per-owner: user id or 'anon')
  const [manualTasks, setManualTasks] = useState([])
  const [doneById, setDoneById] = useState({})
  const [deletedIds, setDeletedIds] = useState({}) // id -> deletion timestamp (tombstones)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  // owner string once THAT owner's state is loaded. The persist effect gates on
  // hydrated === owner: on the commit where `owner` flips, state still holds the
  // previous owner's data, and an ungated persist would write it under the new
  // owner's key (anon tasks injected into a user's account — or worse, reversed).
  const [hydrated, setHydrated] = useState(null)
  const [storageBroken, setStorageBroken] = useState(false)
  const [notifStatus, setNotifStatus] = useState('unavailable')
  const uidRef = useRef(0) // monotonic counter for unique manual-task ids
  const pushTimer = useRef(null)
  // HQ write-back machinery (used by the hydration + done-diff effects below)
  const prevDoneRef = useRef(null) // null = seeding (hydration); diff skipped
  const dismissIntentRef = useRef(new Set())
  const pendingHqRef = useRef({})
  const stateRef = useRef(null) // latest persisted state, for flush-on-background
  const activeUidRef = useRef(null)
  const autoBuiltRef = useRef(false)
  const rebuildRef = useRef(null)
  const cancelFetchRef = useRef(null)

  const sessionUserId = session?.user?.id || null
  const owner = sessionUserId || 'anon'

  // auth: load the session, keep it in sync, and on Google consent push the
  // provider refresh token to the backend (with retries — a single failed POST
  // here used to strand the account on "Preparing your feed" forever).
  // Tier follows the session; the uid guard stops a slow getTier() resolving
  // after sign-out from painting a Pro badge on a signed-out screen.
  useEffect(() => {
    let on = true
    const applySession = (s) => {
      activeUidRef.current = s?.user?.id || null
      setSession(s)
      setAuthReady(true)
      if (s) {
        const uid = s.user?.id
        getTier().then((t) => { if (on && activeUidRef.current === uid) setTier(t) })
        if (s.provider_refresh_token) {
          syncProviderToken(s).then((stored) => {
            if (!on) return
            setTokenSynced(tokenSyncOk())
            // fresh consent = reconnect or first setup: build right away so a
            // reauth clears the warning now, not at the next cron slot
            if (stored) setWantBuild((n) => n + 1)
          })
        }
      } else setTier('free')
    }
    getSession().then((s) => { if (on) applySession(s) })
    const sub = onAuthChange((_event, s) => applySession(s))
    return () => { on = false; sub.unsubscribe() }
  }, [])

  // hydrate persisted state for the CURRENT owner (re-runs on account switch,
  // so user B never sees user A's tasks). First sign-in on a device adopts the
  // anon slate (tasks captured before signing in used to silently vanish).
  // Signed in: also pull the cloud backup and merge it in (restores tasks
  // after a reinstall / new device), tombstones applied.
  useEffect(() => {
    if (!authReady) return
    setHydrated(null)
    prevDoneRef.current = null // re-seed the done-diff for the new owner
    let sv = loadState(owner)
    if (sessionUserId && !sv) {
      const anonSv = loadState('anon')
      if (anonSv?.manualTasks?.length) {
        sv = anonSv
        clearState('anon')
      }
    }
    const localDel = sv?.deletedIds || {}
    const hadLocal = !!sv
    pendingHqRef.current = sv?.hqPending || {} // unfinished status write-backs
    setManualTasks((sv?.manualTasks || []).map(migrateTask))
    setDoneById(sv?.doneById || {})
    setDeletedIds(localDel)
    setSettings({ ...DEFAULT_SETTINGS, ...(sv?.settings || {}) })
    if (sessionUserId) {
      let on = true
      pullTaskState().then((remote) => {
        if (!on || !remote?.state) return
        const r = remote.state
        const del = { ...(r.deletedIds || {}), ...localDel }
        setDeletedIds(del)
        setManualTasks((cur) => mergeTaskLists(cur, (r.manualTasks || []).map(migrateTask), del))
        setDoneById((cur) => ({ ...(r.doneById || {}), ...cur }))
        // fresh install: restore backed-up settings too (brief time, toggles) —
        // but never clobber settings the user already changed on this device
        if (!hadLocal && r.settings) setSettings({ ...DEFAULT_SETTINGS, ...r.settings })
      }).catch(() => {}).finally(() => { if (on) setHydrated(owner) })
      // keep tz + prefs current server-side
      syncProfilePrefs()
      return () => { on = false }
    }
    setHydrated(owner)
  }, [authReady, owner, sessionUserId])

  // billing: identify RevenueCat with the Supabase user id (no-op on web /
  // until keys exist) so purchases map back to this account via the webhook.
  useEffect(() => { if (sessionUserId) initBilling(sessionUserId) }, [sessionUserId])

  const refresh = useCallback(() => {
    // cancel any in-flight fetch (e.g. a slow rebuild-triggered one) so a stale
    // response can never paint a signed-in feed onto a signed-out screen
    cancelFetchRef.current?.()
    let on = true
    cancelFetchRef.current = () => { on = false }
    setLoading(true)
    getFeed(now)
      .then(({ payload, meta }) => {
        if (!on) return
        setFeed(payload)
        setMeta(meta)
        // a built feed exists ⇒ the backend definitely has the token
        if (!meta.demo && !meta.pending) { markTokenSynced(); setTokenSynced(true) }
      })
      .finally(() => { if (on) setLoading(false) })
    return () => { on = false }
  }, [now, sessionUserId])
  useEffect(() => refresh(), [refresh])

  // "Refresh now": actually rebuild the feed server-side (rate-limited), then
  // refetch. Falls back to a plain refetch when signed out / rate-limited.
  const [rebuilding, setRebuilding] = useState(false)
  const rebuild = useCallback(async () => {
    if (rebuilding) return 'busy'
    setRebuilding(true)
    try {
      const r = sessionUserId ? await rebuildFeed() : 'error'
      refresh()
      return r
    } finally {
      setRebuilding(false)
    }
  }, [rebuilding, sessionUserId, refresh])
  rebuildRef.current = rebuild

  // Kick a server-side build without waiting for the user to find
  // Account → Refresh: (a) once, when a signed-in user's feed is still pending
  // (first sign-in used to dead-air for up to a day); (b) whenever a fresh
  // consent just stored a token (reconnect after reauth).
  useEffect(() => {
    if (!sessionUserId || loading) return
    const firstBuild = meta.pending && !meta.error && !autoBuiltRef.current
    if (firstBuild || wantBuild > 0) {
      autoBuiltRef.current = true
      if (wantBuild > 0) setWantBuild(0)
      rebuildRef.current?.()
    }
  }, [sessionUserId, loading, meta.pending, meta.error, wantBuild])

  // advance `now` + refetch on focus/resume, plus a 1-minute tick while
  // visible — without it the Now marker, past-dimming, and even the midnight
  // rollover freeze for as long as the screen stays on.
  useEffect(() => {
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    const bump = () => { if (visible()) setNow(new Date()) }
    const tick = setInterval(bump, 60_000)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', bump)
    if (typeof window !== 'undefined') window.addEventListener('focus', bump)
    return () => {
      clearInterval(tick)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', bump)
      if (typeof window !== 'undefined') window.removeEventListener('focus', bump)
    }
  }, [])

  // notifications: check quietly on mount (never prompts — the OS ask happens
  // only from an explicit user action via enableNotifications)
  useEffect(() => { notificationStatus().then(setNotifStatus) }, [])
  const enableNotifications = useCallback(async () => {
    const ok = await requestNotifications()
    setNotifStatus(ok ? 'granted' : 'denied')
    if (ok) scheduleDailyBrief(settings.briefTime)
    return ok
  }, [settings.briefTime])
  useEffect(() => {
    if (hydrated === owner && notifStatus === 'granted') scheduleDailyBrief(settings.briefTime)
  }, [hydrated, owner, notifStatus, settings.briefTime])

  const todayKey = isoDate(now)
  const isToday = selectedDate === todayKey

  const profile = feed?.profile || { name: '', email: '', avatarUrl: null }
  // Email tasks are a Pro feature AND a user choice (settings.emailTasks
  // mirrors the server-side switch). Free / logged-out users get an upsell card.
  const proTier = tier === 'pro'
  const emailTasks = useMemo(
    () => (proTier && settings.emailTasks !== false ? (feed?.emailTasks || []) : []),
    [feed, proTier, settings.emailTasks],
  )

  // Claude-managed HQ tasks: always the user's own (no tier gate). due labels
  // are computed like manual tasks so rollover buckets stay correct.
  const hqTasks = useMemo(() => {
    const raw = Array.isArray(feed?.hqTasks) ? feed.hqTasks : []
    return raw.map((t) => ({ ...t, due: t.dueDate ? dueLabel(t.dueDate, now) : 'today' }))
  }, [feed, now])

  // Home is ALWAYS today; the Calendar browses selectedDate. Keeping them
  // separate stops a day picked on the Calendar leaking into Home's "Today".
  const todayEvents = useMemo(() => normalizeDay(feed?.days?.[todayKey] || []), [feed, todayKey])
  const selectedEvents = useMemo(
    () => (isToday ? todayEvents : normalizeDay(feed?.days?.[selectedDate] || [])),
    [feed, selectedDate, isToday, todayEvents],
  )
  // dot = the day actually HAS events (not merely "a row exists for it")
  const datesWithEvents = useMemo(
    () => new Set(Object.entries(feed?.days || {}).filter(([, evs]) => (evs || []).length > 0).map(([k]) => k)),
    [feed],
  )
  // which days the feed covers at all — lets the Calendar tell "free day"
  // apart from "no data fetched for this day"
  const datesCovered = useMemo(() => new Set(Object.keys(feed?.days || {})), [feed])

  const autoTasks = useMemo(
    () => (settings.autoDraft ? deriveAutoTasks(todayEvents, now) : []),
    [todayEvents, now, settings.autoDraft],
  )
  // the task list is always about today (auto + email + HQ + manual)
  const tasks = useMemo(
    () => mergeTasks([...autoTasks, ...emailTasks, ...hqTasks], manualTasks.map((t) => ({
      ...t,
      due: t.dueDate ? dueLabel(t.dueDate, now) : t.due,
    })), doneById),
    [autoTasks, emailTasks, hqTasks, manualTasks, doneById, now],
  )
  // Schedule local notifications for Claude-set reminders delivered in the
  // feed (HQ mode); a completed/dismissed task's reminder is cancelled.
  // (This effect must live BELOW the hqTasks declaration — its dep array is
  // evaluated during render, and a forward reference is a TDZ crash.)
  useEffect(() => {
    if (notifStatus !== 'granted') return
    for (const t of hqTasks) {
      if (doneById[t.id]) { cancelTaskReminder(t.id); continue }
      if (t.remindAt && new Date(t.remindAt) > new Date()) {
        scheduleTaskReminder({ id: t.id, title: t.title, remindAt: t.remindAt })
      }
    }
  }, [hqTasks, notifStatus, doneById])

  const grouped = useMemo(() => groupTasks(tasks, now), [tasks, now])
  const timeline = useMemo(() => buildTimeline(selectedEvents, now), [selectedEvents, now])
  const todayTimeline = useMemo(
    () => (isToday ? null : buildTimeline(todayEvents, now)),
    [isToday, todayEvents, now],
  )
  const greeting = useMemo(() => buildGreeting(now, profile.name), [now, profile.name])

  // The AI brief is only trusted while it's from TODAY (local) and shaped like
  // a brief: a malformed cached payload (brief without runs/stats arrays) used
  // to white-screen Home on every launch. Stats are always recomputed live so
  // the tiles can't disagree with the lists below.
  const briefFromToday = useMemo(() => {
    if (!feed?.generatedAt) return false
    return isoDate(new Date(feed.generatedAt)) === todayKey
  }, [feed, todayKey])
  const brief = useMemo(() => {
    const fromFeed = briefFromToday && feed?.brief &&
      Array.isArray(feed.brief.runs) && Array.isArray(feed.brief.stats)
    const base = fromFeed ? feed.brief : buildBrief(todayEvents, tasks, now)
    return { ...base, stats: liveStats(todayEvents, tasks) }
  }, [briefFromToday, feed, todayEvents, tasks, now])

  // persist (prune doneById to live ids so it can't grow unbounded). Keep
  // auto:/mail: done-state even when it's not in the current `tasks` — pruning
  // against it would wipe a completed RSVP/email so it reappears unchecked.
  // Tombstones age out on the same window.
  useEffect(() => {
    if (hydrated !== owner) return
    const ids = new Set(tasks.map((t) => t.id))
    // hq: must be in the keep-list: on cold start the persist effect can run
    // before the feed loads (tasks has no hq ids yet) — pruning then would
    // wipe completed-HQ state so a still-open row reappears unchecked.
    const keep = ([k, v]) =>
      ids.has(k) ||
      ((k.startsWith('auto:') || k.startsWith('mail:') || k.startsWith('hq:')) &&
        Date.now() - (typeof v === 'number' ? v : Date.now()) < RETENTION)
    const prunedDone = Object.fromEntries(Object.entries(doneById).filter(keep))
    const prunedDeleted = Object.fromEntries(
      Object.entries(deletedIds).filter(([, ts]) => Date.now() - ts < RETENTION),
    )
    const state = { v: 5, manualTasks, doneById: prunedDone, deletedIds: prunedDeleted, settings, hqPending: pendingHqRef.current }
    stateRef.current = state
    if (!saveState(owner, state)) setStorageBroken(true)
    // debounced cloud backup (signed-in only)
    if (sessionUserId) {
      clearTimeout(pushTimer.current)
      pushTimer.current = setTimeout(() => { pushTimer.current = null; pushTaskState(state) }, 2500)
    }
    return () => clearTimeout(pushTimer.current)
  }, [hydrated, manualTasks, doneById, deletedIds, settings, tasks, owner, sessionUserId])

  // Flush the pending cloud push when the app is backgrounded — Android kills
  // backgrounded apps freely, and a swipe-away inside the 2.5s debounce used to
  // silently drop the backup of the latest edits.
  const flushPush = useCallback(() => {
    if (!pushTimer.current) return
    clearTimeout(pushTimer.current)
    pushTimer.current = null
    if (stateRef.current) pushTaskState(stateRef.current)
  }, [])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onHide = () => { if (document.visibilityState === 'hidden') flushPush() }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [flushPush])

  // ---- HQ status write-back + completion side effects (single source) ----
  // Everything flows from the doneById DIFF, so the write direction always
  // matches what actually happened — even if two toggles land in one React
  // batch. Failed writes queue in pendingHqRef (persisted) and retry on
  // foreground, so an offline mark-done eventually reaches the server.
  const writeHqStatus = useCallback((id, status) => {
    delete pendingHqRef.current[id]
    setHqTaskStatus(id, status).then((ok) => {
      if (!ok) pendingHqRef.current[id] = status
    })
  }, [])
  useEffect(() => {
    if (hydrated !== owner || prevDoneRef.current === null) {
      prevDoneRef.current = doneById
      return
    }
    const prev = prevDoneRef.current
    prevDoneRef.current = doneById
    for (const id of new Set([...Object.keys(prev), ...Object.keys(doneById)])) {
      const was = !!prev[id]
      const is = !!doneById[id]
      if (was === is) continue
      if (is) cancelTaskReminder(id) // a completed task must never buzz later
      if (id.startsWith('hq:')) {
        const dismissed = dismissIntentRef.current.delete(id)
        writeHqStatus(id, is ? (dismissed ? 'dismissed' : 'done') : 'open')
      }
    }
  }, [doneById, hydrated, owner, writeHqStatus])
  // retry queued write-backs when the app returns to the foreground
  useEffect(() => {
    const retry = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      for (const [id, status] of Object.entries(pendingHqRef.current)) writeHqStatus(id, status)
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', retry)
    if (typeof window !== 'undefined') window.addEventListener('focus', retry)
    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', retry)
      if (typeof window !== 'undefined') window.removeEventListener('focus', retry)
    }
  }, [writeHqStatus])

  // ---- task actions ----
  // toggleTask is a pure flip; reminder-cancel and HQ write-back happen in the
  // diff effect above. The stored value is the completion time (not `true`) so
  // off-day auto/email done entries can be aged out during persist.
  const toggleTask = useCallback((id) => setDoneById((d) => {
    const next = { ...d }
    if (next[id]) delete next[id]
    else next[id] = Date.now()
    return next
  }), [])

  const addTask = useCallback((title, opts = {}) => {
    // monotonic suffix so several adds in the same millisecond (e.g. autorepeat
    // Enter) can't collide on 'u'+Date.now() and duplicate React keys.
    const id = 'u' + Date.now() + '-' + (uidRef.current++)
    setManualTasks((ts) => [...ts, {
      id, title: title || 'New task', source: 'You',
      note: opts.note || '', meta: 'added just now',
      dueDate: opts.dueDate || null, due: opts.due || 'today',
      urgent: !!opts.urgent, remindAt: opts.remindAt || null,
      order: ts.reduce((m, t) => Math.max(m, t.order || 0), 0) + 1,
      updatedAt: Date.now(),
    }])
    if (opts.remindAt) scheduleTaskReminder({ id, title: title || 'New task', remindAt: opts.remindAt })
    return id
  }, [])

  const editTask = useCallback((id, patch) => {
    setManualTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)))
    // Only touch the reminder when the edit actually carries a remindAt key
    // (the sheet omits it when the user didn't change the reminder chip).
    // remindAt set → (re)schedule; explicit null → cancel any stale notification.
    if ('remindAt' in patch) {
      if (patch.remindAt) scheduleTaskReminder({ id, title: patch.title, remindAt: patch.remindAt })
      else cancelTaskReminder(id)
    }
  }, [])

  // Returns the removed task so the caller can offer Undo. Tombstoned so the
  // cloud merge can't resurrect it via another device's stale copy.
  const deleteTask = useCallback((id) => {
    let removed = null
    setManualTasks((ts) => {
      removed = ts.find((t) => t.id === id) || null
      return ts.filter((t) => t.id !== id)
    })
    setDeletedIds((d) => ({ ...d, [id]: Date.now() }))
    setDoneById((d) => { const n = { ...d }; delete n[id]; return n })
    cancelTaskReminder(id) // never leave a ghost notification for a deleted task
    return removed
  }, [])

  // Undo for deleteTask: puts the exact task back (id, order, reminder and all)
  // with a fresh updatedAt so it outlives its own tombstone in the merge.
  const restoreTask = useCallback((task) => {
    if (!task) return
    setManualTasks((ts) => (ts.some((t) => t.id === task.id) ? ts : [...ts, { ...task, updatedAt: Date.now() }]))
    setDeletedIds((d) => { const n = { ...d }; delete n[task.id]; return n })
    if (task.remindAt) scheduleTaskReminder(task)
  }, [])

  // newOrderIds: manual-task ids in their new order
  const reorderTasks = useCallback((newOrderIds) => {
    setManualTasks((ts) => {
      // Reassign only the order-slots the dragged subset already occupies, so a
      // reorder within one bucket can't collide with another bucket's 0,1,2…
      const idset = new Set(newOrderIds)
      const slots = ts.filter((t) => idset.has(t.id)).map((t) => t.order ?? 0).sort((a, b) => a - b)
      const rank = new Map(newOrderIds.map((id, i) => [id, slots[i]]))
      return ts.map((t) => (idset.has(t.id) ? { ...t, order: rank.get(t.id) } : t))
    })
  }, [])

  // HQ dismissal: hides it locally like a done task AND tells the backend it
  // wasn't useful (status 'dismissed'), so the morning run learns from it.
  // The intent marker makes the diff effect write 'dismissed' instead of 'done'.
  const dismissHqTask = useCallback((id) => {
    dismissIntentRef.current.add(id)
    setDoneById((d) => ({ ...d, [id]: Date.now() }))
  }, [])
  const undoDismissHqTask = useCallback((id) => {
    dismissIntentRef.current.delete(id)
    setDoneById((d) => { const n = { ...d }; delete n[id]; return n })
  }, [])

  const clearCompleted = useCallback(() => {
    const gone = manualTasks.filter((t) => doneById[t.id]).map((t) => t.id)
    if (!gone.length) return
    const ts = Date.now()
    setDeletedIds((d) => {
      const n = { ...d }
      gone.forEach((id) => { n[id] = ts })
      return n
    })
    setManualTasks((list) => list.filter((t) => !doneById[t.id]))
  }, [manualTasks, doneById])

  const setSetting = useCallback((k, v) => {
    setSettings((s) => ({ ...s, [k]: v }))
    // brief time drives BOTH the local ping and the server build hour
    if (k === 'briefTime') {
      const m = /^(\d{1,2}):\d{2}\s*(AM|PM)?$/i.exec(String(v).trim())
      if (m) {
        let h = parseInt(m[1], 10)
        const ap = (m[2] || '').toUpperCase()
        if (ap === 'PM' && h < 12) h += 12
        if (ap === 'AM' && h === 12) h = 0
        syncProfilePrefs({ briefHour: h })
      }
    }
    // the email-tasks switch is enforced server-side (Gmail fetch skipped)
    if (k === 'emailTasks') syncProfilePrefs({ emailTasks: !!v })
  }, [])

  const disconnect = useCallback(async () => {
    // flush the cloud backup before the session dies — the debounced push would
    // otherwise be cancelled and the last ~2.5s of edits never reach user_state
    clearTimeout(pushTimer.current)
    pushTimer.current = null
    if (sessionUserId && stateRef.current) {
      try { await pushTaskState(stateRef.current) } catch {}
    }
    cancelAll() // no ghost "your day is ready" pings for a signed-out account
    clearTokenSynced()
    autoBuiltRef.current = false
    try { await signOut() } finally { clearCache() }
    // drop this account's in-memory state immediately — the owner-keyed
    // hydration effect will load the anon slate
    setManualTasks([])
    setDoneById({})
    setDeletedIds({})
    setSettings(DEFAULT_SETTINGS)
    setFeed(null)
    setNow(new Date())
  }, [sessionUserId])

  // Play-required in-app account deletion: server wipe first (all rows + Vault
  // token + the auth user), then the same local teardown as sign-out plus this
  // owner's stored state. Returns 'deleted' | 'error' for the UI.
  const removeAccount = useCallback(async () => {
    const r = await cloudDeleteAccount()
    if (r !== 'deleted') return r
    clearTimeout(pushTimer.current)
    pushTimer.current = null
    cancelAll()
    clearTokenSynced()
    clearState(owner)
    autoBuiltRef.current = false
    try { await signOut() } catch { /* the auth user is already gone */ }
    clearCache()
    setManualTasks([])
    setDoneById({})
    setDeletedIds({})
    setSettings(DEFAULT_SETTINGS)
    setFeed(null)
    setNow(new Date())
    return 'deleted'
  }, [owner])

  // start the Pro purchase flow; refresh tier on success. Returns the RevenueCat
  // status ('pro' | 'unavailable' | 'cancelled' | ...) so the UI can respond.
  const upgradeToPro = useCallback(async () => {
    const r = await purchasePro()
    if (r.status === 'pro') getTier().then(setTier)
    return r
  }, [])

  const user = session?.user || null
  const signedIn = !!session
  const isPro = tier === 'pro'

  return {
    loading, profile, greeting, now, nowLabel: fmtTime(now),
    brief, briefFromToday, timeline, todayTimeline, tasks, grouped, manualTasks,
    selectedDate, setSelectedDate, datesWithEvents, datesCovered, isToday, todayKey,
    settings, setSetting,
    toggleTask, addTask, editTask, deleteTask, restoreTask, reorderTasks, clearCompleted,
    dismissHqTask, undoDismissHqTask,
    notifStatus, enableNotifications, storageBroken,
    // auth + entitlement
    session, user, signedIn, authReady, tier, isPro, upgradeToPro, tokenSynced,
    feedMeta: meta, feedConfigured: signedIn, generatedAt: feed?.generatedAt || null,
    refresh, rebuild, rebuilding, disconnect, signOut: disconnect, removeAccount,
  }
}
