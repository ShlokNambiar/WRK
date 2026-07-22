import { Fragment, useState } from 'react'
import TimelineEvent from '../components/TimelineEvent.jsx'
import NowMarker from '../components/NowMarker.jsx'
import Pressable from '../components/Pressable.jsx'
import { Empty } from './HomeScreen.jsx'
import { isoDate } from '../providers/feed.js'
import { useMeasuredHeight } from '../hooks/useMeasuredHeight.js'
import { C, FONT_SERIF, FONT_SANS } from '../theme.js'

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export default function CalendarScreen({ day, mobile, reduced, onAddTask, openEventDetail }) {
  const { timeline, nowLabel, now, loading, selectedDate, setSelectedDate, datesWithEvents, datesCovered } = day
  const headerTop = mobile ? 'calc(14px + env(safe-area-inset-top))' : '54px'
  const [headerRef, headerH] = useMeasuredHeight()
  const [weekOffset, setWeekOffset] = useState(0)

  const todayKey = isoDate(now)
  const dow = (now.getDay() + 6) % 7
  const monday = new Date(now); monday.setDate(now.getDate() - dow + weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d })

  const selDate = new Date(selectedDate + 'T00:00:00')
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(selDate).toUpperCase()
  const title = selectedDate === todayKey ? 'Today'
    : new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(selDate)
  const showNow = selectedDate === todayKey
  const nowIndex = timeline.findIndex((e) => !e.isPast)

  // the feed covers today..+6; outside that we say so instead of faking "free"
  const selectedCovered = datesCovered.has(selectedDate)
  const emptyText = !selectedCovered
    ? (selectedDate < todayKey ? 'Past days aren’t kept in your feed.' : 'This day isn’t in your feed yet — it goes 7 days out.')
    : showNow ? 'No events today.' : 'No events this day.'

  const stepWeek = (dir) => {
    setWeekOffset((w) => w + dir)
    // keep the selection inside the visible week so the header matches the strip
    const d = new Date(monday); d.setDate(monday.getDate() + dir * 7)
    setSelectedDate(isoDate(d))
  }

  return (
    <>
      <header ref={headerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, background: C.paper, padding: `${headerTop} 22px 0` }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12.5, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted, fontWeight: 600 }}>{monthLabel}</div>
            <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 34, lineHeight: 1, letterSpacing: '-.015em', margin: '6px 0 0', color: C.ink }}>{title}</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Pressable ariaLabel="Previous week" onPress={() => stepWeek(-1)} style={navBtn}>‹</Pressable>
            {weekOffset !== 0 && (
              <Pressable ariaLabel="Back to this week" onPress={() => { setWeekOffset(0); setSelectedDate(todayKey) }}
                style={{ ...navBtn, width: 'auto', padding: '0 12px', fontSize: 12, fontWeight: 700, color: C.blue }}>Today</Pressable>
            )}
            <Pressable ariaLabel="Next week" onPress={() => stepWeek(1)} style={navBtn}>›</Pressable>
            <Pressable ariaLabel="New task" onPress={onAddTask} style={{ width: 44, height: 44, borderRadius: '50%', background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22, fontWeight: 300, boxShadow: '0 6px 16px rgba(26,24,240,.34)' }}>+</Pressable>
          </div>
        </div>
        {/* week strip — tap a day to view it */}
        <div style={{ display: 'flex', gap: 6, padding: '18px 0 14px' }}>
          {days.map((d, i) => {
            const key = isoDate(d)
            const isSel = key === selectedDate
            const isToday = key === todayKey
            const hasEvents = datesWithEvents.has(key)
            const label = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(d)
            return (
              <Pressable key={key} ariaLabel={label} ariaPressed={isSel} onPress={() => setSelectedDate(key)} scale={0.92} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: isSel || isToday ? 700 : 600, color: isSel ? C.blue : isToday ? C.blue : '#71706a' }}>{LETTERS[i]}</div>
                <div style={{
                  marginTop: 7, minHeight: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15, fontWeight: isSel || isToday ? 700 : 600, position: 'relative',
                  background: isSel ? C.blue : 'transparent',
                  color: isSel ? '#fff' : '#4a4a44',
                  boxShadow: isSel ? '0 6px 14px rgba(26,24,240,.32)' : isToday ? 'inset 0 0 0 1.5px rgba(26,24,240,.35)' : 'none',
                }}>
                  {d.getDate()}
                  {hasEvents && <span style={{ position: 'absolute', bottom: 5, left: '50%', transform: 'translateX(-50%)', width: 5, height: 5, borderRadius: '50%', background: isSel ? '#fff' : C.amber }} />}
                </div>
              </Pressable>
            )
          })}
        </div>
      </header>

      <main className="wrk-scroll" style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        top: headerH || (mobile ? 'calc(168px + env(safe-area-inset-top))' : 172),
        overflowY: 'auto', padding: '12px 22px 0',
      }}>
        {timeline.length === 0 && !loading && <Empty text={emptyText} />}
        {timeline.map((ev, i) => (
          <Fragment key={ev.id}>
            {showNow && i === nowIndex && <NowMarker label={nowLabel} />}
            <TimelineEvent ev={ev} isLast={i === timeline.length - 1} reduced={reduced} onOpen={openEventDetail} />
          </Fragment>
        ))}
        <div style={{ height: mobile ? 'calc(140px + env(safe-area-inset-bottom))' : 130 }} />
      </main>
    </>
  )
}

const navBtn = {
  width: 44, height: 44, borderRadius: '50%', background: '#fff', display: 'flex',
  alignItems: 'center', justifyContent: 'center', color: '#4a4a44', fontSize: 18,
  fontWeight: 600, boxShadow: '0 2px 10px rgba(0,0,0,.07)',
}
