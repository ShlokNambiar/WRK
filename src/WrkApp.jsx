import { useEffect, useState } from 'react'
import { MotionConfig, useReducedMotion } from 'framer-motion'
import TabBar from './components/TabBar.jsx'
import Sheet from './components/Sheet.jsx'
import HomeScreen from './screens/HomeScreen.jsx'
import TasksScreen from './screens/TasksScreen.jsx'
import CalendarScreen from './screens/CalendarScreen.jsx'
import AccountScreen from './screens/AccountScreen.jsx'
import AddTaskSheet from './screens/AddTaskSheet.jsx'
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
  const [sheet, setSheet] = useState(null) // null | {mode:'add'} | {mode:'edit', task}

  const onTab = (key) => { haptics.light(); setActiveTab(key) }
  const openSheet = () => { haptics.success(); setSheet({ mode: 'add' }) }
  const openEdit = (id) => {
    const t = day.manualTasks.find((x) => x.id === id)
    if (t) { haptics.light(); setSheet({ mode: 'edit', task: t }) }
  }
  const closeSheet = () => setSheet(null)

  const toggleTask = (id) => { haptics.light(); day.toggleTask(id) }
  const dayWithHaptics = { ...day, toggleTask }

  const Screen = SCREENS[activeTab] || HomeScreen

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

            <Screen day={dayWithHaptics} mobile={mobile} reduced={reduced} onAddTask={openSheet} goToAccount={() => setActiveTab('card')} openEdit={openEdit} />

            <TabBar active={activeTab} reduced={reduced} onTab={onTab} onAdd={openSheet} />

            <Sheet open={!!sheet} onClose={closeSheet} reduced={reduced}>
              <AddTaskSheet day={dayWithHaptics} editing={sheet?.mode === 'edit' ? sheet.task : null} onClose={closeSheet} />
            </Sheet>
          </div>
        </div>
      </div>
    </MotionConfig>
  )
}
