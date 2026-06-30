// Google OAuth via Google Identity Services (GIS) token client — browser flow,
// no client secret on the device. Designed for a PERSONAL app kept in OAuth
// "testing" mode, where ALL scopes (incl. full Gmail) work with no verification.
// See CONNECT_GOOGLE.md for the 5-minute Google Cloud setup.
//
// Scopes requested = "access to everything" you asked for:
export const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ')

const LS_TOKEN = 'wrk.google.token'   // { access_token, expiry }
const LS_CID = 'wrk.google.client_id' // optional runtime override

function clientId() {
  return (
    (typeof localStorage !== 'undefined' && localStorage.getItem(LS_CID)) ||
    import.meta.env?.VITE_GOOGLE_CLIENT_ID ||
    ''
  )
}

export function setClientId(id) {
  try { localStorage.setItem(LS_CID, id.trim()) } catch {}
}

function readToken() {
  if (typeof localStorage === 'undefined') return null
  try { return JSON.parse(localStorage.getItem(LS_TOKEN) || 'null') } catch { return null }
}
function writeToken(t) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(LS_TOKEN, JSON.stringify(t)) } catch {}
}

export function isConnected() {
  return !!readToken()
}

// Lazy-load the GIS script once.
let gisPromise = null
function loadGis() {
  if (gisPromise) return gisPromise
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(s)
  })
  return gisPromise
}

function requestToken({ prompt }) {
  return new Promise((resolve, reject) => {
    const cid = clientId()
    if (!cid) return reject(new Error('NO_CLIENT_ID'))
    loadGis().then(() => {
      // Everything from here can throw synchronously — keep it inside try/catch
      // so the promise always settles (otherwise the caller hangs forever).
      try {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: cid,
          scope: SCOPES,
          callback: (resp) => {
            if (resp.error) return reject(new Error(resp.error))
            const tok = { access_token: resp.access_token, expiry: Date.now() + (resp.expires_in - 60) * 1000 }
            writeToken(tok)
            resolve(tok.access_token)
          },
          error_callback: (err) => reject(new Error(err?.type || 'oauth_error')),
        })
        client.requestAccessToken({ prompt })
      } catch (e) { reject(e) }
    }).catch(reject)
  })
}

// User-initiated connect (shows the Google consent screen). Throws a
// human-readable Error on any failure so the UI can show it.
export async function connectGoogle() {
  try {
    await requestToken({ prompt: 'consent' })
    return true
  } catch (e) {
    if (e.message === 'NO_CLIENT_ID') throw new Error('Add your Google client ID first — see CONNECT_GOOGLE.md.')
    if (e.message === 'popup_closed' || e.message === 'access_denied') throw new Error('Connection cancelled.')
    throw new Error('Couldn’t reach Google. Check the client ID and your connection, then retry.')
  }
}

// Returns a valid access token, refreshing silently if expired. null if not connected.
export async function getAccessToken() {
  const t = readToken()
  if (!t) return null
  if (t.expiry > Date.now()) return t.access_token
  // expired — try a silent refresh (no prompt)
  try { return await requestToken({ prompt: '' }) } catch { return null }
}

export function disconnectGoogle() {
  const t = readToken()
  try {
    if (t?.access_token && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(t.access_token, () => {})
    }
  } catch {}
  try { localStorage.removeItem(LS_TOKEN) } catch {}
}
