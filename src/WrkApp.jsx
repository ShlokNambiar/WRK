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
import { useDayModel } from './hooks/useDayModel.js'
import { haptics } from './lib/haptics.js'
import { C } from './theme.js'

const NOISE =
  "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22 stitchTiles=%22stitch%22/><feColorMatrix type=%22saturate%22 values=%220%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%220.045%22/></svg>"

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 480px)')
    const fn = (e) => setM(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return m
}

const SCREENS = { home: HomeScreen, tasks: TasksScreen, calendar: CalendarScreen, card: AccountScreen }

export default function WrkApp() {
  const reduced = !!useReducedMotion()
  const mobile = useIsMobile()
  const day = useDayModel()

  const [activeTab, setActiveTab] = useState('home')
  // null | {mode:'add'} | {mode:'edit', task} | {mode:'event', ev} | {mode:'task', task}
  const [sheet, setSheet] = useState(null)
  const [snack, setSnack] = useState(null)
  const [ask, setAsk] = useState(null) // Confirm dialog payload
  const sheetDirty = useRef(false)

  const onTab = (key) => { haptics.light(); setActiveTab(key) }
  const openSheet = () => { haptics.success(); setSheet({ mode: 'add' }) }
  const openEdit = (id) => {
    const t = day.manualTasks.find((x) => x.id === id)
    if (t) { haptics.light(); setSheet({ mode: 'edit', task: t }) }
  }
  const openTaskDetail = (task) => { haptics.light(); setSheet({ mode: 'task', task }) }
  const openEventDetail = (ev) => { haptics.light(); setSheet({ mode: 'event', ev }) }

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
    if (!Capacitor?.isNativePlatform?.()) return
    let sub = null
    let on = true
    import('@capacitor/app').then(({ App }) => {
      if (!on) return
      sub = App.addListener('backButton', () => {
        const s = backState.current
        if (s.ask) setAsk(null)
        else if (s.sheet) closeSheet()
        else if (s.activeTab !== 'home') setActiveTab('home')
        else App.minimizeApp()
      })
    }).catch(() => {})
    return () => { on = false; sub?.then?.(); sub?.remove?.() }
  }, [closeSheet])

  // toggle with undo: completing a task offers a 5s way back
  const toggleTask = (id) => {
    haptics.light()
    const t = day.tasks.find((x) => x.id === id)
    day.toggleTask(id)
    if (t && !t.done) {
      setSnack({ key: 'done' + id + Date.now(), text: `Done: ${t.title}`, actionLabel: 'Undo', onAction: () => day.toggleTask(id) })
    }
  }
  const onDeleted = (removed) => {
    if (!removed) return
    setSnack({ key: 'del' + removed.id, text: `Deleted “${removed.title}”`, actionLabel: 'Undo', onAction: () => day.restoreTask(removed) })
  }
  const dayWithHaptics = { ...day, toggleTask }

  const Screen = SCREENS[activeTab] || HomeScreen

  const sheetLabel = sheet?.mode === 'edit' ? 'Edit task'
    : sheet?.mode === 'event' ? 'Event details'
      : sheet?.mode === 'task' ? 'Task details' : 'New task'

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

            <Screen
              day={dayWithHaptics} mobile={mobile} reduced={reduced}
              onAddTask={openSheet} goToAccount={() => setActiveTab('card')}
              openEdit={openEdit} openTaskDetail={openTaskDetail} openEventDetail={openEventDetail}
              onSnack={setSnack} onAsk={setAsk}
            />

            <TabBar active={activeTab} reduced={reduced} onTab={onTab} onAdd={openSheet} />

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
          </div>
        </div>
      </div>
    </MotionConfig>
  )
}
