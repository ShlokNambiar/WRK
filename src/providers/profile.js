// User profile. Real Google "basic" profile when connected; mock otherwise.
import { getAccessToken, isConnected } from '../lib/googleAuth.js'

export async function getProfile() {
  const token = await getAccessToken()
  if (!token) {
    // mock only when never connected; otherwise a neutral "reconnect" profile
    return isConnected()
      ? { name: '', email: '', avatarUrl: null }
      : { name: 'Alex', email: 'alex@pepl.life', avatarUrl: null }
  }

  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const u = await r.json()
    return { name: u.given_name || u.name || 'there', email: u.email || '', avatarUrl: u.picture || null }
  } catch {
    return { name: 'there', email: '', avatarUrl: null }
  }
}
