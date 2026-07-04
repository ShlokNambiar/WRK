// Native shell setup (Capacitor). No-ops on web — guarded by isNativePlatform
// so the browser build never touches a native-only API.
import { Capacitor } from '@capacitor/core'
import { completeOAuthRedirect } from './supabase.js'

export async function initNative() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // Draw the app behind the status bar (design already reserves the top inset)
    await StatusBar.setOverlaysWebView({ overlay: true })
    // Light background → dark icons
    await StatusBar.setStyle({ style: Style.Light })
  } catch {}

  // OAuth deep link: Google → Supabase → com.metis.wrk://auth?code=… lands here.
  // Finish the exchange so onAuthStateChange fires SIGNED_IN and the app updates.
  try {
    const { App } = await import('@capacitor/app')
    App.addListener('appUrlOpen', ({ url }) => {
      if (url && url.startsWith('com.metis.wrk://')) {
        completeOAuthRedirect(url).catch((e) => console.error('[oauth] exchange failed', e))
      }
    })
  } catch {}
}
