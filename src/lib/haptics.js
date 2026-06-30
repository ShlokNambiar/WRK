// Haptic feedback. Uses the web Vibration API now; when packaged with
// Capacitor, it picks up @capacitor/haptics automatically (and no-ops on web).
//
// The specifier is assembled at runtime so neither the Vite dev server nor the
// production bundler tries to resolve an optional dep that isn't installed on
// web. When you add @capacitor/haptics for a native build, this import resolves.
const CAP_HAPTICS = ['@capacitor', 'haptics'].join('/')

let cap = null
async function capImpact() {
  try {
    if (cap === null) {
      cap = (await import(/* @vite-ignore */ CAP_HAPTICS).catch(() => false)) || false
    }
    if (cap && cap.Haptics) {
      await cap.Haptics.impact({ style: cap.ImpactStyle?.Light })
      return true
    }
  } catch {}
  return false
}

function vibrate(ms) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms)
  } catch {}
}

export const haptics = {
  light() { capImpact().then((ok) => { if (!ok) vibrate(8) }) },
  medium() { capImpact().then((ok) => { if (!ok) vibrate(16) }) },
  success() { capImpact().then((ok) => { if (!ok) vibrate([10, 40, 16]) }) },
}
