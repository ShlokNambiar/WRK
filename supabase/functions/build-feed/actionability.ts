// AI actionability filter: given the "undecided" email candidates (subject +
// sender only), asks the model which ones plausibly need a personal reply, and
// returns just those. Automated/transactional mail (bank alerts, statements,
// receipts, OTPs, shipping/delivery, security alerts, newsletters, app/system
// notifications, calendar invites) is dropped even when it isn't a no-reply
// address — that's the gap a rule-based filter can't close.
//
// Provider selection mirrors the brief: Anthropic when its key is set, else
// Gemini. On ANY error this throws so the caller falls back to the cheap-rule
// result (keep the undecided set) rather than silently dropping real mail.
//
// PRIVACY: only subject + sender are ever sent — never a body (google.ts fetches
// format=metadata). Same class of data the brief already sends.
import type { Candidate } from './emailFilter.ts'

// Bounded so a hung API can't stall the build; a timeout throws like any other
// error and the caller keeps the undecided set.
const AI_TIMEOUT_MS = 30_000

const SYSTEM = `You triage an inbox. For each numbered email you get only its subject and sender. Decide which emails plausibly need a PERSONAL REPLY from the user.
- NEEDS a reply: a real person writing to them, a question, a request awaiting their response.
- Does NOT need a reply (exclude): bank/transaction alerts, account statements, receipts, invoices, OTP/verification codes, order/shipping/delivery updates, security or login alerts, newsletters, marketing/promotions, social or app or system notifications, calendar invites, automated "do not reply" mail.
Respond with ONLY a JSON object, no prose, no markdown: {"reply":[<0-based indices of the emails that need a reply>]}. If none, {"reply":[]}.`

function listText(cands: Candidate[]): string {
  return cands.map((c, i) => `${i}. subject: ${c.subject || '(none)'} | from: ${c.from || '(none)'}`).join('\n')
}

async function askModel(
  user: string,
  keys: { anthropic?: string; gemini?: string },
  fetchFn: typeof fetch,
): Promise<string> {
  if (keys.anthropic) {
    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': keys.anthropic, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 300, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error('actionability: anthropic status ' + res.status)
    const data = await res.json()
    const text = data?.content?.find((b: any) => b.type === 'text')?.text ?? data?.content?.[0]?.text
    if (typeof text !== 'string') throw new Error('actionability: no anthropic text')
    return text
  }
  if (keys.gemini) {
    const res = await fetchFn('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': keys.gemini },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error('actionability: gemini status ' + res.status)
    const data = await res.json()
    const parts = data?.candidates?.[0]?.content?.parts
    const text = Array.isArray(parts) ? parts.map((p: any) => p?.text).filter((t: any) => typeof t === 'string').join('') : undefined
    if (typeof text !== 'string' || !text) throw new Error('actionability: no gemini text')
    return text
  }
  throw new Error('actionability: no provider key configured')
}

export async function classifyActionable(
  candidates: Candidate[],
  keys: { anthropic?: string; gemini?: string },
  fetchFn: typeof fetch = fetch,
): Promise<Candidate[]> {
  if (candidates.length === 0) return []
  const raw = await askModel(listText(candidates), keys, fetchFn)
  const parsed = JSON.parse(raw)
  const idx: unknown = parsed?.reply
  if (!Array.isArray(idx)) throw new Error('actionability: response missing reply[]')
  const keep = new Set(idx.filter((n): n is number => Number.isInteger(n)))
  return candidates.filter((_, i) => keep.has(i))
}
