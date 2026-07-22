import { useCallback, useEffect, useRef, useState } from 'react'
import { MotionConfig, useReducedMotion } from 'framer-motion'
import { Capacitor } from '@capacitor/core'
import TabBar from './components/TabBar.jsx'
import Sheet from './components/Sheet.jsx'
import Snackbar from './components/Snackbar.jsx'
import Confirm from './components/Confirm.jsx'
import HomeScreen from './screens/HomeScreen.jsx'
import TasksScreen from './screens/TasksScreen.jsx'
import CalendarScreen from './screens/CalendarScreen.jsx'
import AccountScreen from './screens/AccountScreen.jsx'
import AddTaskSheet from './screens/AddTaskSheet.jsx'
import EventDetailSheet from './screens/EventDetailSheet.jsx'
import TaskDetailSheet from './screens/TaskDetailSheet.jsx'
import IntroScreen from './screens/IntroScreen.jsx'
import { useDayModel } from './hooks/useDayModel.js'
import { haptics } from './lib/haptics.js'
import { C } from './theme.js'

const NOISE =
  "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22 stitchTiles=%22stitch%22/><feColorMatrix type=%22saturate%22 values=%220%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%220.045%22/></svg>"

const IS_NATIVE = !!Capacitor?.isNativePlatform?.()

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 480px)')
    const fn = (e) => setM(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  // The desktop preview bezel is a WEB demo affordance. On a real device it
  // must never render (rotating to landscape used to put a fake iPhone frame
  // + notch inside the actual app).
  return m || IS_NATIVE
}

const SCREENS = { home: HomeScreen, tasks: TasksScreen, calendar: CalendarScreen, card: AccountScreen }

export default function WrkApp() {
  const reduced = !!useReducedMotion()
  const mobile = useIsMobile()
  const day = useDayModel()
  const dayRef = useRef(day)
  dayRef.current = day

  const [activeTab, setActiveTab] = useState('home')
  // null | {mode:'add'} | {mode:'edit', task} | {mode:'event', ev} | {mode:'task', task}
  const [sheet, setSheet] = useState(null)
  const [snack, setSnack] = useState(null)
  const [ask, setAsk] = useState(null) // Confirm dialog payload
  const sheetDirty = useRef(false)

  // one-time intro before the consent wall — only for brand-new, signed-out
  // users (authReady gate stops it flashing while a session restores)
  const [showIntro, setShowIntro] = useState(() => {
    try { return !localStorage.getItem('wrk.seenIntro') } catch { return false }
  })
  const dismissIntro = useCallback((goSignIn) => {
    try { localStorage.setItem('wrk.seenIntro', '1') } catch {}
    setShowIntro(false)
    if (goSignIn) setActiveTab('card')
  }, [])

  const onTab = useCallback((key) => { haptics.light(); setActiveTab(key) }, [])
  const openSheet = useCallback(() => { haptics.success(); setSheet({ mode: 'add' }) }, [])
  const openEdit = useCallback((id) => {
    const t = dayRef.current.manualTasks.find((x) => x.id === id)
    if (t) { haptics.light(); setSheet({ mode: 'edit', task: t }) }
  }, [])
  const openTaskDetail = useCallback((task) => { haptics.light(); setSheet({ mode: 'task', task }) }, [])
  const openEventDetail = useCallback((ev) => { haptics.light(); setSheet({ mode: 'event', ev }) }, [])

  // A dirty add-draft asks before it's thrown away (scrim tap, back, Cancel).
  const closeSheet = useCallback(() => {
    if (sheetDirty.current) {
      setAsk({
        title: 'Discard this task?',
        body: 'You have an unsaved task in progress.',
        confirmLabel: 'Discard', tone: 'red',
        onConfirm: () => { sheetDirty.current = false; setSheet(null) },
      })
      return
    }
    setSheet(null)
  }, [])

  // Android back: close dialogs/sheets first, then return Home, then leave the
  // app (minimize, never kill). Without this listener back exits mid-draft.
  const backState = useRef({})
  backState.current = { sheet, ask, activeTab }
  useEffect(() => {
    if (!IS_NATIVE) return
    let on = true
    let handle = null
    import('@capacitor/app')
      .then(({ App }) => App.addListener('backButton', () => {
        const s = backState.current
        if (s.ask) setAsk(null)
        else if (s.sheet) closeSheet()
        else if (s.activeTab !== 'home') setActiveTab('home')
        else App.minimizeApp()
      }))
      // addListener returns a promise of the handle — the old cleanup called
      // .remove() on the PROMISE, which removed nothing
      .then((h) => { if (on) handle = h; else h.remove() })
      .catch(() => {})
    return () => { on = false; handle?.remove() }
  }, [closeSheet])

  // storage write failures are otherwise invisible: tasks look saved (React
  // state) and evaporate on relaunch. Warn once per session.
  const storageWarned = useRef(false)
  useEffect(() => {
    if (day.storageBroken && !storageWarned.current) {
      storageWarned.current = true
      setSnack({ key: 'storage', text: 'Storage is full — changes may not survive a restart' })
    }
  }, [day.storageBroken])

  // toggle with undo: completing a task offers a way back. Stable identity so
  // memo(TaskRow) actually skips re-renders.
  const toggleTask = useCallback((id) => {
    haptics.light()
    const t = dayRef.current.tasks.find((x) => x.id === id)
    dayRef.current.toggleTask(id)
    if (t && !t.done) {
      setSnack({ key: 'done' + id + Date.now(), text: `Done: ${t.title}`, actionLabel: 'Undo', onAction: () => dayRef.current.toggleTask(id) })
    }
  }, [])
  const onDeleted = useCallback((removed) => {
    if (!removed) return
    setSnack({ key: 'del' + removed.id, text: `Deleted “${removed.title}”`, actionLabel: 'Undo', onAction: () => dayRef.current.restoreTask(removed) })
  }, [])
  const dayWithHaptics = { ...day, toggleTask }

  const Screen = SCREENS[activeTab] || HomeScreen

  const sheetLabel = sheet?.mode === 'edit' ? 'Edit task'
    : sheet?.mode === 'event' ? 'Event details'
      : sheet?.mode === 'task' ? 'Task details' : 'New task'

  // While a sheet or dialog is up, the screen behind it must be inert —
  // aria-modal alone is unreliable under TalkBack in the Android WebView, so
  // swipe-navigation could walk into the covered tab bar.
  const blocked = !!(sheet || ask)

  // frame styles (responsive)
  const outer = mobile
    ? { minHeight: '100dvh', width: '100%', background: '#0a0a0a' }
    : { minHeight: '100vh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', background: 'radial-gradient(120% 100% at 50% 0%,#efeee9,#e3e2dc)' }
  const bezel = mobile
    ? { position: 'relative', width: '100%', minHeight: '100dvh', background: '#0a0a0a' }
    : { position: 'relative', width: 393, height: 852, background: '#0a0a0a', borderRadius: 56, padding: 11, boxShadow: '0 40px 90px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.16)' }
  const screen = {
    position: 'relative', width: '100%', height: mobile ? '100dvh' : '100%',
    borderRadius: mobile ? 0 : 46, overflow: 'hidden', backgroundColor: C.paper,
    backgroundImage: `url('${NOISE}')`,
  }

  return (
    <MotionConfig reducedMotion="user">
      <div style={outer}>
        <div style={bezel}>
          <div style={screen}>
            {/* fake notch (desktop preview only) */}
            {!mobile && <div style={{ position: 'absolute', top: 13, left: '50%', transform: 'translateX(-50%)', width: 108, height: 30, background: '#0a0a0a', borderRadius: 16, zIndex: 50 }} />}

            <div inert={blocked ? '' : undefined} style={{ position: 'absolute', inset: 0 }}>
              <Screen
                day={dayWithHaptics} mobile={mobile} reduced={reduced}
                onAddTask={openSheet} goToAccount={() => setActiveTab('card')}
                openEdit={openEdit} openTaskDetail={openTaskDetail} openEventDetail={openEventDetail}
                onSnack={setSnack} onAsk={setAsk}
              />
              <TabBar active={activeTab} reduced={reduced} onTab={onTab} onAdd={openSheet} />
            </div>

            <Sheet open={!!sheet} onClose={closeSheet} reduced={reduced} label={sheetLabel}>
              {(sheet?.mode === 'add' || sheet?.mode === 'edit') && (
                <AddTaskSheet
                  day={dayWithHaptics}
                  editing={sheet?.mode === 'edit' ? sheet.task : null}
                  onClose={closeSheet}
                  onDirtyChange={(d) => { sheetDirty.current = d }}
                  onDeleted={onDeleted}
                />
              )}
              {sheet?.mode === 'event' && <EventDetailSheet ev={sheet.ev} onClose={() => setSheet(null)} />}
              {sheet?.mode === 'task' && (
                <TaskDetailSheet task={sheet.task} day={dayWithHaptics} onClose={() => setSheet(null)} onSnack={setSnack} />
              )}
            </Sheet>

            <Snackbar snack={snack} onDismiss={() => setSnack(null)} reduced={reduced} />
            <Confirm ask={ask} onClose={() => setAsk(null)} reduced={reduced} />

            {showIntro && day.authReady && !day.signedIn && (
              <IntroScreen reduced={reduced} onDone={dismissIntro} />
            )}
          </div>
        </div>
      </div>
    </MotionConfig>
  )
}
