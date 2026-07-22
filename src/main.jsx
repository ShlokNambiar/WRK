import React from 'react'
import { createRoot } from 'react-dom/client'

// Bundled font (no Google CDN dependency — works offline / when packaged)
import '@fontsource/newsreader/400.css'
import '@fontsource/newsreader/500.css'
import '@fontsource/newsreader/600.css'
import '@fontsource/newsreader/400-italic.css'
import '@fontsource/newsreader/600-italic.css'

import './index.css'
import WrkApp from './WrkApp.jsx'
import { initNative } from './lib/native.js'

// Last-resort crash screen. Without a boundary, any render throw unmounts the
// whole tree — a permanent white screen inside the WebView, with no console and
// no way out. Worse: crashing input is often PERSISTED (feed cache / task
// state), so a poison payload would crash every launch. "Clear cached data"
// removes the wrk.* keys (never the Supabase session) and reloads.
class CrashGuard extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    // no telemetry yet — logcat/devtools is all we have in the field
    console.error('[wrk] render crash', error, info?.componentStack)
  }
  clearAndReload = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('wrk.') || k.startsWith('wrk-app.'))
        .forEach((k) => localStorage.removeItem(k))
    } catch {}
    window.location.reload()
  }
  render() {
    if (!this.state.error) return this.props.children
    const btn = {
      display: 'block', width: '100%', padding: '14px 16px', borderRadius: 16,
      border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer', minHeight: 48,
    }
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f7f7f4', padding: 28, fontFamily: 'system-ui, sans-serif', color: '#26251f',
      }}>
        <div style={{ maxWidth: 340, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden="true">⚠</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Something broke</h1>
          <p style={{ fontSize: 14, color: '#6f6e63', margin: '0 0 20px', lineHeight: 1.5 }}>
            WRK hit an unexpected error. Reloading usually fixes it; if it keeps
            happening, clear the cached data (your account and tasks in the cloud
            are safe).
          </p>
          <button style={{ ...btn, background: '#1a18f0', color: '#fff', marginBottom: 10 }}
            onClick={() => window.location.reload()}>Reload</button>
          <button style={{ ...btn, background: 'transparent', color: '#6f6e63', border: '1px solid #d8d7cf' }}
            onClick={this.clearAndReload}>Clear cached data &amp; reload</button>
        </div>
      </div>
    )
  }
}

initNative()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <CrashGuard>
      <WrkApp />
    </CrashGuard>
  </React.StrictMode>,
)
