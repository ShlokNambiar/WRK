// Assembles the whole app from a single JSON feed (produced by the build-feed
// edge function). Owns manual tasks, done-state, brief settings, and the
// selected calendar day. Persisted locally per-account; offline-first, with a
// debounced cloud backup so a reinstall restores tasks.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getFeed, normalizeDay, isoDate } from '../providers/feed.js'
import { loadState, saveState } from '../lib/storage.js'
import { clearCache } from '../lib/feedConfig.js'
import { getSession, onAuthChange, signOut } from '../lib/supabase.js'
import { syncProviderToken } from '../lib/syncToken.js'
import { syncProfilePrefs, pushTaskState, pullTaskState, rebuildFeed } from '../lib/cloud.js'
import { getTier } from '../providers/entitlement.js'
import { initBilling, purchasePro } from '../lib/billing.js'
import {
  notificationStatus, requestNotifications, scheduleDailyBrief,
  scheduleTaskReminder, cancelTaskReminder,
} from '../lib/notifications.js'
import {
  buildTimeline, deriveAutoTasks, buildBrief, buildGreeting, mergeTasks, groupTasks,
  liveStats, dueLabel, fmtTime,
} from '../lib/derive.js'

const DEFAULT_SETTINGS = { briefTime: '7:00 AM', autoDraft: true }

// Legacy tasks stored their note in `meta` (colliding with system strings like
// "added just now"); migrate it into a dedicated `note` field once.
function migrateTask(t) {
  if (t.note !== undefined) return t
  const isSystemMeta = !t.meta || /^(added|from)/i.test(t.meta)
  return { ...t, note: isSystemMeta ? '' : t.meta, meta: isSystemMeta ? t.meta : 'added earlier' }
}

// Union two task lists by id, local first (local edits win over the backup).
function mergeTaskLists(local, remote) {
  const seen = new Set(local.map((t) => t.id))
  return [...local, ...(remote || []).filter((t) => !seen.has(t.id))]
}

export function useDayModel() {
  const [now, setNow] = useState(() => new Date())
  const [feed, setFeed] = useState(null)
  const [meta, setMeta] = useState({ demo: true, stale: false, error: false, needsReauth: false })
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(() => isoDate(new Date()))

  // auth + entitlement
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [tier, setTier] = useState('free')

  // user-owned state (per-owner: user id or 'anon')
  const [manualTasks, setManualTasks] = useState([])
  const [doneById, setDoneById] = useState({})
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [hydrated, setHydrated] = useState(false)
  const [notifStatus, setNotifStatus] = useState('unavailable')
  const uidRef = useRef(0) // monotonic counter for unique manual-task ids
  const pushTimer = useRef(null)

  const sessionUserId = session?.user?.id || null
  const owner = sessionUserId || 'anon'

  // auth: load the session, keep it in sync, and on first Google consent push
  // the provider refresh token to the backend. Tier follows the session.
  useEffect(() => {
    let on = true
    getSession().then((s) => {
      if (!on) return
      setSession(s)
      setAuthReady(true)
      if (s) { syncProviderToken(s); getTier().then((t) => on && setTier(t)) }
    })
    const sub = onAuthChange((_event, s) => {
      setSession(s)
      setAuthReady(true)
      if (s) { syncProviderToken(s); getTier().then((t) => setTier(t)) }
      else setTier('free')
    })
    return () => { on = false; sub.unsubscribe() }
  }, [])

  // hydrate persisted state for the CURRENT owner (re-runs on account switch,
  // so user B never sees user A's tasks). Signed in: also pull the cloud
  // backup and union it in (restores tasks after a reinstall / new device).
  useEffect(() => {
    if (!authReady) return
    setHydrated(false)
    const sv = loadState(owner)
    const localTasks = (sv?.manualTasks || []).map(migrateTask)
    setManualTasks(localTasks)
    setDoneById(sv?.doneById || {})
    setSettings({ ...DEFAULT_SETTINGS, ...(sv?.settings || {}) })
    if (sessionUserId) {
      let on = true
      pullTaskState().then((remote) => {
        if (!on || !remote?.state) return
        const r = remote.state
        setManualTasks((cur) => mergeTaskLists(cur, (r.manualTasks || []).map(migrateTask)))
        setDoneById((cur) => ({ ...(r.doneById || {}), ...cur }))
        setHydrated(true)
      }).catch(() => {}).finally(() => { if (on) setHydrated(true) })
      // keep tz (and later brief hour) current server-side
      syncProfilePrefs()
      return () => { on = false }
    }
    setHydrated(true)
  }, [authReady, owner, sessionUserId])

  // billing: configure RevenueCat with the Supabase user id (no-op on web /
  // until keys exist) so purchases map back to this account via the webhook.
  useEffect(() => { if (sessionUserId) initBilling(sessionUserId) }, [sessionUserId])

  const refresh = useCallback(() => {
    setLoading(true)
    let on = true
    getFeed(now)
      .then(({ payload, meta }) => { if (!on) return; setFeed(payload); setMeta(meta) })
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

  // advance `now` + refetch on focus/resume (keeps the day correct across midnight)
  useEffect(() => {
    const bump = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') setNow(new Date()) }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', bump)
    if (typeof window !== 'undefined') window.addEventListener('focus', bump)
    return () => {
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
    if (hydrated && notifStatus === 'granted') scheduleDailyBrief(settings.briefTime)
  }, [hydrated, notifStatus, settings.briefTime])

  const todayKey = isoDate(now)
  const isToday = selectedDate === todayKey

  const profile = feed?.profile || { name: '', email: '', avatarUrl: null }
  // Email tasks are a Pro feature. Free / logged-out users get an upsell card.
  const proTier = tier === 'pro'
  const emailTasks = useMemo(() => (proTier ? (feed?.emailTasks || []) : []), [feed, proTier])

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
  // the task list is always about today (auto + email + manual)
  const tasks = useMemo(
    () => mergeTasks([...autoTasks, ...emailTasks], manualTasks.map((t) => ({
      ...t,
      due: t.dueDate ? dueLabel(t.dueDate, now) : t.due,
    })), doneById),
    [autoTasks, emailTasks, manualTasks, doneById, now],
  )
  const grouped = useMemo(() => groupTasks(tasks, now), [tasks, now])
  const timeline = useMemo(() => buildTimeline(selectedEvents, now), [selectedEvents, now])
  const todayTimeline = useMemo(
    () => (isToday ? null : buildTimeline(todayEvents, now)),
    [isToday, todayEvents, now],
  )
  const greeting = useMemo(() => buildGreeting(now, profile.name), [now, profile.name])

  // The AI brief is only trusted while it's from TODAY (local): yesterday's
  // "Good morning, 3 meetings" must never render as the current day. Stats are
  // always recomputed live so the tiles can't disagree with the lists below.
  const briefFromToday = useMemo(() => {
    if (!feed?.generatedAt) return false
    return isoDate(new Date(feed.generatedAt)) === todayKey
  }, [feed, todayKey])
  const brief = useMemo(() => {
    const base = briefFromToday && feed?.brief ? feed.brief : buildBrief(todayEvents, tasks, now)
    return { ...base, stats: liveStats(todayEvents, tasks) }
  }, [briefFromToday, feed, todayEvents, tasks, now])

  // persist (prune doneById to live ids so it can't grow unbounded). Keep
  // auto:/mail: done-state even when it's not in the current `tasks` — pruning
  // against it would wipe a completed RSVP/email so it reappears unchecked.
  useEffect(() => {
    if (!hydrated) return
    const ids = new Set(tasks.map((t) => t.id))
    const WINDOW = 30 * 864e5 // keep off-day auto/email done-state ~30 days, then let it expire
    const keep = ([k, v]) =>
      ids.has(k) ||
      ((k.startsWith('auto:') || k.startsWith('mail:')) &&
        Date.now() - (typeof v === 'number' ? v : Date.now()) < WINDOW)
    const prunedDone = Object.fromEntries(Object.entries(doneById).filter(keep))
    const state = { v: 4, manualTasks, doneById: prunedDone, settings }
    saveState(owner, state)
    // debounced cloud backup (signed-in only)
    if (sessionUserId) {
      clearTimeout(pushTimer.current)
      pushTimer.current = setTimeout(() => pushTaskState(state), 2500)
    }
    return () => clearTimeout(pushTimer.current)
  }, [hydrated, manualTasks, doneById, settings, tasks, owner, sessionUserId])

  // ---- task actions ----
  const toggleTask = useCallback((id) => setDoneById((d) => {
    const next = { ...d }
    // store the completion time (not just `true`) so off-day auto/email done
    // entries can be aged out during persist instead of accumulating forever.
    if (next[id]) delete next[id]
    else {
      next[id] = Date.now()
      cancelTaskReminder(id) // a completed task must never buzz the phone later
    }
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
    }])
    if (opts.remindAt) scheduleTaskReminder({ id, title: title || 'New task', remindAt: opts.remindAt })
    return id
  }, [])

  const editTask = useCallback((id, patch) => {
    setManualTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    // Only touch the reminder when the edit actually carries a remindAt key
    // (the sheet omits it when the user didn't change the reminder chip).
    // remindAt set → (re)schedule; explicit null → cancel any stale notification.
    if ('remindAt' in patch) {
      if (patch.remindAt) scheduleTaskReminder({ id, title: patch.title, remindAt: patch.remindAt })
      else cancelTaskReminder(id)
    }
  }, [])

  // Returns the removed task so the caller can offer Undo.
  const deleteTask = useCallback((id) => {
    let removed = null
    setManualTasks((ts) => {
      removed = ts.find((t) => t.id === id) || null
      return ts.filter((t) => t.id !== id)
    })
    setDoneById((d) => { const n = { ...d }; delete n[id]; return n })
    cancelTaskReminder(id) // never leave a ghost notification for a deleted task
    return removed
  }, [])

  // Undo for deleteTask: puts the exact task back (id, order, reminder and all).
  const restoreTask = useCallback((task) => {
    if (!task) return
    setManualTasks((ts) => (ts.some((t) => t.id === task.id) ? ts : [...ts, task]))
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

  const clearCompleted = useCallback(() => {
    setManualTasks((ts) => ts.filter((t) => !doneById[t.id]))
  }, [doneById])

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
  }, [])

  const disconnect = useCallback(async () => {
    // flush the cloud backup before the session dies
    clearTimeout(pushTimer.current)
    try { await signOut() } finally { clearCache() }
    // drop this account's in-memory state immediately — the owner-keyed
    // hydration effect will load the anon slate
    setManualTasks([])
    setDoneById({})
    setSettings(DEFAULT_SETTINGS)
    setFeed(null)
    setNow(new Date())
  }, [])

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
    notifStatus, enableNotifications,
    // auth + entitlement
    session, user, signedIn, tier, isPro, upgradeToPro,
    feedMeta: meta, feedConfigured: signedIn, generatedAt: feed?.generatedAt || null,
    refresh, rebuild, rebuilding, disconnect, signOut: disconnect,
  }
}
