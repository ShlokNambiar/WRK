import { useState } from 'react'
import { Reorder } from 'framer-motion'
import TaskRow from '../components/TaskRow.jsx'
import Pressable from '../components/Pressable.jsx'
import { Empty } from './HomeScreen.jsx'
import { C, FONT_SERIF, FONT_SANS } from '../theme.js'

export default function TasksScreen({ day, mobile, reduced, openEdit }) {
  const { grouped, toggleTask } = day
  const [filter, setFilter] = useState('open')
  const headerTop = mobile ? 'calc(14px + env(safe-area-inset-top))' : '54px'

  const openCount = grouped.overdue.length + grouped.today.length + grouped.week.length
  const chips = [
    { key: 'open', label: `Open · ${openCount}` },
    { key: 'today', label: 'Today' },
    { key: 'done', label: `Done · ${grouped.done.length}` },
  ]

  const sections = filter === 'done'
    ? [['Done', grouped.done]]
    : filter === 'today'
      ? [['Today', grouped.today]]
      : [['Overdue', grouped.overdue], ['Today', grouped.today], ['This week', grouped.week]]

  const total = sections.reduce((n, [, list]) => n + list.length, 0)

  return (
    <>
      <header style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, padding: `${headerTop} 22px 12px`,
        background: 'linear-gradient(180deg,rgba(247,247,244,.96),rgba(247,247,244,0))',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      }}>
        <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 36, lineHeight: 1, letterSpacing: '-.015em', margin: 0, color: C.ink }}>Tasks</h1>
        <div className="wrk-scroll" style={{ display: 'flex', gap: 7, overflowX: 'auto', marginTop: 14 }}>
          {chips.map((c) => {
            const on = filter === c.key
            return (
              <Pressable key={c.key} onPress={() => setFilter(c.key)}
                style={{
                  flex: 'none', padding: '7px 14px', borderRadius: 14, fontSize: 12.5, fontWeight: 600,
                  background: on ? C.blue : '#fff', color: on ? '#fff' : '#4a4a44',
                  boxShadow: on ? '0 4px 12px rgba(26,24,240,.28)' : '0 2px 8px rgba(0,0,0,.05)',
                }}>{c.label}</Pressable>
            )
          })}
        </div>
      </header>

      <main className="wrk-scroll" style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        top: mobile ? 'calc(164px + env(safe-area-inset-top))' : 168,
        overflowY: 'auto', padding: '6px 22px 0',
      }}>
        {total === 0 && <Empty text="No tasks here. Enjoy the calm." />}
        {sections.map(([label, list]) => {
          if (list.length === 0) return null
          const fixed = list.filter((t) => t.source !== 'You')
          const manual = list.filter((t) => t.source === 'You')
          return (
            <div key={label}>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: C.muted, margin: '16px 0 11px', fontFamily: FONT_SANS }}>{label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {fixed.map((t) => (
                  <TaskRow key={t.id} task={t} onToggle={toggleTask} onEdit={openEdit} reduced={reduced} />
                ))}
              </div>
              {manual.length > 0 && (
                <Reorder.Group
                  axis="y"
                  values={manual}
                  onReorder={(nl) => day.reorderTasks(nl.map((t) => t.id))}
                  style={{ listStyle: 'none', margin: fixed.length ? '10px 0 0' : 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  {manual.map((t) => (
                    <Reorder.Item key={t.id} as="div" value={t}>
                      <TaskRow task={t} onToggle={toggleTask} onEdit={openEdit} reduced={reduced} />
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              )}
            </div>
          )
        })}
        <div style={{ height: mobile ? 'calc(140px + env(safe-area-inset-bottom))' : 130 }} />
      </main>
    </>
  )
}
