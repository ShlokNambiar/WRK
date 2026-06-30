// Pro-tier warm brief via the Anthropic Messages API (claude-haiku-4-5 — the
// cost-appropriate model approved in the spec). Raw HTTP with an injectable
// fetch keeps this unit-testable in Node without bundling the SDK in the Deno
// edge runtime. On ANY error this throws, so the caller falls back to the
// deterministic templateBrief.
//
// PRIVACY: only event titles/times and email subjects + sender names are sent
// to the API. Email bodies are never fetched (google.ts uses format=metadata),
// so they cannot leak here.
import type { Brief, FeedEvent, EmailTask } from './buildPayload.ts'

const MODEL = 'claude-haiku-4-5'
const ENDPOINT = 'https://api.anthropic.com/v1/messages'

const SYSTEM = `You write a warm, concise "morning brief" for a personal productivity app.
Given today's calendar events and the emails that need a reply, respond with ONLY a JSON object — no prose, no markdown fences — matching exactly:
{"runs":[{"text":"..."},{"text":"...","emph":true}],"stats":[{"n":"<count>","label":"meetings"},{"n":"<count>","label":"to do"},{"n":"<count>","label":"flagged"}],"text":"..."}
- runs: 1-3 short fragments that read as one warm sentence or two; set "emph":true on at most one fragment to highlight the most important thing.
- stats: exactly three, in this order: meetings (event count), to do (email-task count), flagged (urgent email-task count).
- text: the same brief as a single plain string.
Keep it human and brief. Never invent events or emails that were not provided.`

function userContent(events: FeedEvent[], emailTasks: EmailTask[]): string {
  const evLines = events.length
    ? events.map((e) => `- ${e.title} @ ${e.start}`).join('\n')
    : '(none)'
  const mailLines = emailTasks.length
    ? emailTasks.map((t) => `- ${t.title} (${t.meta})${t.urgent ? ' [urgent]' : ''}`).join('\n')
    : '(none)'
  return `Today's meetings:\n${evLines}\n\nEmails needing a reply:\n${mailLines}\n\nCounts — meetings: ${events.length}, to do: ${emailTasks.length}, flagged: ${emailTasks.filter((t) => t.urgent).length}.`
}

function validateBrief(obj: unknown): Brief {
  const b = obj as Brief
  if (!b || !Array.isArray(b.runs) || !Array.isArray(b.stats) || typeof b.text !== 'string') {
    throw new Error('claudeBrief: response did not match Brief shape')
  }
  if (b.stats.length !== 3 || !b.runs.every((r) => typeof r?.text === 'string')) {
    throw new Error('claudeBrief: invalid runs/stats')
  }
  return b
}

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
