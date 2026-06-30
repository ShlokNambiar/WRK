// Local notifications. No-ops on web; when packaged with Capacitor it picks up
// @capacitor/local-notifications automatically (gated by Capacitor.isNativePlatform()).
//
// The specifier is assembled at runtime so neither the Vite dev server nor the
// production bundler tries to resolve an optional dep that isn't installed on web.
// When you add @capacitor/local-notifications for a native build, this resolves.
import { Capacitor } from '@capacitor/core'

const CAP_LOCAL_NOTIFS = ['@capacitor', 'local-notifications'].join('/')

// Reserved id for the recurring daily-brief notification.
const DAILY_BRIEF_ID = 1
// Task reminder ids are offset above this so they can never collide with id 1.
const TASK_ID_OFFSET = 1000

let mod = null
async function getLN() {
  try {
    if (!Capacitor?.isNativePlatform?.()) return false
    if (mod === null) {
      mod = (await import(/* @vite-ignore */ CAP_LOCAL_NOTIFS).catch(() => false)) || false
    }
    if (mod && mod.LocalNotifications) return mod.LocalNotifications
  } catch {}
  return false
}

// Small deterministic string hash -> non-negative int. Used to derive a stable
// numeric notification id from a task's (possibly string) id.
function hashId(str) {
  try {
    const s = String(str)
    let h = 0
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0
    }
    // 31-bit positive, then offset above the reserved daily-brief id.
    return TASK_ID_OFFSET + (Math.abs(h) % 2000000000)
  } catch {
    return TASK_ID_OFFSET
  }
}

// Parse '7:00 AM' / 'h:mm AM/PM' (also tolerates 24h 'H:mm') -> { hour, minute }.
function parseTime(timeStr) {
  try {
    const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
    if (!m) return { hour: 7, minute: 0 }
    let hour = parseInt(m[1], 10)
    const minute = parseInt(m[2], 10)
    const ap = m[3] ? m[3].toUpperCase() : null
    if (ap === 'PM' && hour < 12) hour += 12
    if (ap === 'AM' && hour === 12) hour = 0
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return { hour: 7, minute: 0 }
    return { hour, minute }
  } catch {
    return { hour: 7, minute: 0 }
  }
}

export async function initNotifications() {
  try {
    const LN = await getLN()
    if (!LN) return false
    await LN.requestPermissions()
    return true
  } catch {}
  return false
}

export async function scheduleDailyBrief(timeStr) {
  try {
    const LN = await getLN()
    if (!LN) return false
    const { hour, minute } = parseTime(timeStr)
    await LN.cancel({ notifications: [{ id: DAILY_BRIEF_ID }] }).catch(() => {})
    await LN.schedule({
      notifications: [
        {
          id: DAILY_BRIEF_ID,
          title: 'Your day is ready',
          body: "Open WRK for today's brief",
          schedule: { on: { hour, minute }, every: 'day', allowWhileIdle: true },
        },
      ],
    })
    return true
  } catch {}
  return false
}

export async function scheduleTaskReminder(task) {
  try {
    const LN = await getLN()
    if (!LN) return false
    if (!task || !task.remindAt) return false
    const at = new Date(task.remindAt)
    if (isNaN(at.getTime()) || at.getTime() <= Date.now()) return false
    const id = hashId(task.id)
    await LN.cancel({ notifications: [{ id }] }).catch(() => {})
    await LN.schedule({
      notifications: [
        {
          id,
          title: 'Reminder',
          body: task.title || '',
          schedule: { at, allowWhileIdle: true },
        },
      ],
    })
    return true
  } catch {}
  return false
}

export async function cancelTaskReminder(id) {
  try {
    const LN = await getLN()
    if (!LN) return false
    await LN.cancel({ notifications: [{ id: hashId(id) }] })
    return true
  } catch {}
  return false
}

export async function cancelAll() {
  try {
    const LN = await getLN()
    if (!LN) return false
    const pending = await LN.getPending().catch(() => null)
    if (pending && Array.isArray(pending.notifications) && pending.notifications.length) {
      await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) })
    }
    return true
  } catch {}
  return false
}
