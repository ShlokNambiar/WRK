// Tiny localStorage wrapper with graceful fallback (private mode / SSR).
const KEY = 'wrk-app.v1'

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {}
}

export function clearState() {
  try {
    localStorage.removeItem(KEY)
  } catch {}
}
