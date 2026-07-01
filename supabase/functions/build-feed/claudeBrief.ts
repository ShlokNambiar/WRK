// Pro-tier warm brief via the Anthropic Messages API (claude-haiku-4-5 — the
// cost-appropriate model approved in the spec). Raw HTTP with an injectable
// fetch keeps this unit-testable in Node without bundling the SDK in the Deno
// edge runtime. On ANY error this throws, so the caller falls back to the
// deterministic templateBrief.
//
// The system prompt / user-content / validation are shared with every other
// provider in briefShared.ts (see the PRIVACY note there).
import type { Brief, FeedEvent, EmailTask } from './buildPayload.ts'
import { SYSTEM, userContent, validateBrief } from './briefShared.ts'

const MODEL = 'claude-haiku-4-5'
const ENDPOINT = 'https://api.anthropic.com/v1/messages'

export async function claudeBrief(
  events: FeedEvent[],
  emailTasks: EmailTask[],
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<Brief> {
  const res = await fetchFn(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent(events, emailTasks) }],
    }),
  })
  if (!res.ok) throw new Error('claudeBrief: API status ' + res.status)
  const data = await res.json()
  const text = data?.content?.find((b: any) => b.type === 'text')?.text ?? data?.content?.[0]?.text
  if (typeof text !== 'string') throw new Error('claudeBrief: no text in response')
  return validateBrief(JSON.parse(text))
}
