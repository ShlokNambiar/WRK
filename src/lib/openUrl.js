// Open an external URL: Chrome Custom Tab on native (keeps the app alive),
// new tab on web. Never navigates the app's own webview away.
import { Capacitor } from '@capacitor/core'

export async function openUrl(url) {
  if (!url) return false
  try {
    if (Capacitor?.isNativePlatform?.()) {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url })
      return true
    }
  } catch {}
  try {
    window.open(url, '_blank', 'noopener')
    return true
  } catch {
    return false
  }
}
