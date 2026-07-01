// Assembles the whole app from a single JSON feed (produced by a scheduled
// Claude routine — no Google OAuth in the app). Owns manual tasks, done-state,
// brief settings, and the selected calendar day. Persisted locally; offline-first.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getFeed, normalizeDay, isoDate } from '../providers/feed.js'
import { loadState, saveState } from '../lib/storage.js'
import { clearCache } from '../lib/feedConfig.js'
import { getSession, onAuthChange, signOut } from '../lib/supabase.js'
import { syncProviderToken } from '../lib/syncToken.js'
import { getTier } from '../providers/entitlement.js'
import { initBilling, purchasePro } from '../lib/billing.js'
import { initNotifications, scheduleDailyBrief, scheduleTaskReminder, cancelTaskReminder } from '../lib/notifications.js'
import {
  buildTimeline, deriveAutoTasks, buildBrief, buildGreeting, mergeTasks, groupTasks, fmtTime,
} from '../lib/derive.js'

const DEFAULT_SETTINGS = { briefTime: '7:00 AM', autoDraft: true }

export function useDayModel() {
  const [now, setNow] = useState(() => new Date())
  const [feed, setFeed] = useState(null)
  const [meta, setMeta] = useState({ demo: true, stale: false, error: false, needsReauth: false })
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(() => isoDate(new Date()))

  // auth + entitlement
  const [session, setSession] = useState(null)
  const [tier, setTier] = useState('free')

  // user-owned state
  const [manualTasks, setManualTasks] = useState([])
  const [doneById, setDoneById] = useState({})
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [hydrated, setHydrated] = useState(false)
  const uidRef = useRef(0) // monotonic counter for unique manual-task ids

  // hydrate persisted state
  useEffect(() => {
    const sv = loadState()
    if (sv) {
      setManualTasks(sv.manualTasks || [])
      setDoneById(sv.doneById || {})
      setSettings({ ...DEFAULT_SETTINGS, ...(sv.settings || {}) })
    }
    setHydrated(true)
  }, [])

  // auth: load the session, keep it in sync, and on first Google consent push
  // the provider refresh token to the backend. Tier follows the session.
  useEffect(() => {
    let on = true
    getSession().then((s) => {
      if (!on) return
      setSession(s)
      if (s) { syncProviderToken(s); getTier().then((t) => on && setTier(t)) }
    })
    const sub = onAuthChange((_event, s) => {
      setSession(s)
      if (s) { syncProviderToken(s); getTier().then((t) => setTier(t)) }
      else setTier('free')
    })
    return () => { on = false; sub.unsubscribe() }
  }, [])

  // fetch the feed (re-runs when the session changes — getFeed reads the
  // signed-in user's own row)
  const sessionUserId = session?.user?.id || null

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

  // notifications: ask once, (re)schedule the morning brief when the time changes
  useEffect(() => { initNotifications() }, [])
  useEffect(() => {
    if (hydrated) scheduleDailyBrief(settings.briefTime)
  }, [hydrated, settings.briefTime])

  const todayKey = isoDate(now)
  const isToday = selectedDate === todayKey

  const profile = feed?.profile || { name: '', email: '', avatarUrl: null }
  // Email tasks are a Pro feature. Free / logged-out users get an upsell card.
  const proTier = tier === 'pro'
  const emailTasks = useMemo(() => (proTier ? (feed?.emailTasks || []) : []), [feed, proTier])
  const events = useMemo(() => normalizeDay(feed?.days?.[selectedDate] || []), [feed, selectedDate])
  const datesWithEvents = useMemo(() => new Set(Object.keys(feed?.days || {})), [feed])

  const autoTasks = useMemo(
    () => (settings.autoDraft ? deriveAutoTasks(events, now) : []),
    [events, now, settings.autoDraft],
  )
  // tasks shown are for "today" (auto + email + manual); other days show just events
  const tasks = useMemo(
    () => mergeTasks([...(isToday ? autoTasks : []), ...(isToday ? emailTasks : [])], manualTasks, doneById),
    [autoTasks, emailTasks, manualTasks, doneById, isToday],
  )
  const grouped = useMemo(() => groupTasks(tasks), [tasks])
  const timeline = useMemo(() => buildTimeline(events, now), [events, now])
  const greeting = useMemo(() => buildGreeting(now, profile.name), [now, profile.name])
  const brief = useMemo(
    () => (isToday && feed?.brief ? feed.brief : buildBrief(events, tasks, now)),
    [isToday, feed, events, tasks, now],
  )

  // persist (prune doneById to live ids so it can't grow unbounded). Keep
  // auto:/mail: done-state even when it's not in the current `tasks` — on a
  // non-today day (or Free / signed-out) `tasks` omits those, and pruning
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
    saveState({ v: 3, manualTasks, doneById: prunedDone, settings })
  }, [hydrated, manualTasks, doneById, settings, tasks])

  // ---- task actions ----
  const toggleTask = useCallback((id) => setDoneById((d) => {
    const next = { ...d }
    // store the completion time (not just `true`) so off-day auto/email done
    // entries can be aged out during persist instead of accumulating forever.
    if (next[id]) delete next[id]; else next[id] = Date.now()
    return next
  }), [])

  const addTask = useCallback((title, opts = {}) => {
    // monotonic suffix so several adds in the same millisecond (e.g. autorepeat
    // Enter) can't collide on 'u'+Date.now() and duplicate React keys.
    const id = 'u' + Date.now() + '-' + (uidRef.current++)
    setManualTasks((ts) => [...ts, {
      id, title: title || 'New task', source: 'You', meta: opts.note || 'added just now',
      due: opts.due || 'today', urgent: !!opts.urgent, bucket: opts.bucket || 'today',
      remindAt: opts.remindAt || null,
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

  const deleteTask = useCallback((id) => {
    setManualTasks((ts) => ts.filter((t) => t.id !== id))
    setDoneById((d) => { const n = { ...d }; delete n[id]; return n })
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

  const setSetting = useCallback((k, v) => setSettings((s) => ({ ...s, [k]: v })), [])
  const disconnect = useCallback(async () => {
    await signOut()
    clearCache()
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
    brief, timeline, tasks, grouped, manualTasks,
    selectedDate, setSelectedDate, datesWithEvents, isToday,
    settings, setSetting,
    toggleTask, addTask, editTask, deleteTask, reorderTasks,
    // auth + entitlement
    session, user, signedIn, tier, isPro, upgradeToPro,
    feedMeta: meta, feedConfigured: signedIn, generatedAt: feed?.generatedAt || null,
    refresh, disconnect, signOut: disconnect,
  }
}
