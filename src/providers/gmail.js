// Gmail -> email-derived tasks ("reply to X"). Real inbox query when connected;
// mock otherwise. Real path needs the (restricted, personal-only) gmail.readonly
// scope — fine in OAuth "testing" mode with no verification. See CONNECT_GOOGLE.md.
import { getAccessToken, isConnected } from '../lib/googleAuth.js'

const G = 'https://gmail.googleapis.com/gmail/v1/users/me'

const MOCK = [
  { id: 'mail:sarah', title: 'Reply to Sarah re: contract', source: 'Email', meta: 'from Sarah Chen', due: '10am', urgent: true, bucket: 'overdue' },
  { id: 'mail:pr', title: 'Approve design-tokens PR', source: 'Email', meta: 'from GitHub', due: 'today', bucket: 'today' },
  { id: 'mail:q3', title: 'Send Q3 numbers to finance', source: 'Email', meta: 'from Priya', due: 'Thu', bucket: 'week' },
]

function headerVal(msg, name) {
  return (msg.payload?.headers || []).find((h) => h.name === name)?.value || ''
}
function senderName(from) {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</)
  return (m ? m[1] : from.split('@')[0]).trim()
}

export async function getEmailTasks() {
  const token = await getAccessToken()
  if (!token) return isConnected() ? [] : MOCK

  const auth = { headers: { Authorization: `Bearer ${token}` } }
  try {
    const q = encodeURIComponent('is:unread in:inbox -category:promotions -category:social')
    const res = await fetch(`${G}/messages?q=${q}&maxResults=8`, auth)
    if (!res.ok) return [] // 401 etc — no fake data when connected
    const list = await res.json()
    const ids = (list.messages || []).slice(0, 8)
    // allSettled: one bad message fetch shouldn't wipe the whole list
    const settled = await Promise.allSettled(ids.map(async (m) => {
      const r = await fetch(`${G}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, auth)
      if (!r.ok) throw new Error('msg ' + r.status)
      const msg = await r.json()
      const subject = headerVal(msg, 'Subject') || '(no subject)'
      return {
        id: `mail:${m.id}`,
        title: `Reply: ${subject}`,
        source: 'Email',
        meta: `from ${senderName(headerVal(msg, 'From'))}`,
        due: 'today', bucket: 'today',
      }
    }))
    return settled.filter((s) => s.status === 'fulfilled').map((s) => s.value)
  } catch {
    return []
  }
}
