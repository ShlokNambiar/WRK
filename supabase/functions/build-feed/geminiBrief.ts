// Pro-tier warm brief via the Google Gemini API (gemini-2.5-flash). Same shape
// contract as claudeBrief — shared system prompt / validation in briefShared.ts.
// Raw HTTP with an injectable fetch keeps it unit-testable in Node. On ANY error
// this throws, so the caller falls back to the deterministic templateBrief.
//
// Notes:
// - thinkingBudget: 0 disables Gemini 2.5's reasoning pass — we don't need it for
//   a short brief, and leaving it on would burn output tokens and add latency.
// - responseMimeType forces raw JSON out (no markdown fences to strip).
// - The key goes in the x-goog-api-key header, NOT the URL query string, so it
//   never lands in request logs.
import type { Brief, FeedEvent, EmailTask } from './buildPayload.ts'
import { SYSTEM, userContent, validateBrief } from './briefShared.ts'

const MODEL = 'gemini-2.5-flash'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

export async function geminiBrief(
  events: FeedEvent[],
  emailTasks: EmailTask[],
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<Brief> {
  const res = await fetchFn(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{ parts: [{ text: userContent(events, emailTasks) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 512,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  })
  if (!res.ok) throw new Error('geminiBrief: API status ' + res.status)
  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts
  const text = Array.isArray(parts)
    ? parts.map((p: any) => p?.text).filter((t: any) => typeof t === 'string').join('')
    : undefined
  if (typeof text !== 'string' || !text) throw new Error('geminiBrief: no text in response')
  return validateBrief(JSON.parse(text))
}
