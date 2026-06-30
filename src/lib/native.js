// Native shell setup (Capacitor). No-ops on web — guarded by isNativePlatform
// so the browser build never touches a native-only API.
import { Capacitor } from '@capacitor/core'

export async function initNative() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // Draw the app behind the status bar (design already reserves the top inset)
    await StatusBar.setOverlaysWebView({ overlay: true })
    // Light background → dark icons
    await StatusBar.setStyle({ style: Style.Light })
  } catch {}
}
