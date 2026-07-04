// Shared brief contract used by every AI provider (claudeBrief, geminiBrief).
// Keeping the system prompt, the user-content builder, and the shape validator
// in one place means the two providers can't drift to different output formats.
//
// PRIVACY: userContent only ever includes event titles/times and email
// subjects + sender names. Email bodies are never fetched (google.ts uses
// format=metadata), so nothing sensitive can leak into any provider call.
import type { Brief, FeedEvent, EmailTask } from './buildPayload.ts'

export const SYSTEM = `You write a warm, concise "morning brief" for a personal productivity app.
Given today's meetings, reminders/blocks, and the emails that need a reply, respond with ONLY a JSON object — no prose, no markdown fences — matching exactly:
{"runs":[{"text":"..."},{"text":"...","emph":true}],"stats":[{"n":"<count>","label":"meetings"},{"n":"<count>","label":"to do"},{"n":"<count>","label":"flagged"}],"text":"..."}
- runs: 1-3 short fragments that read as one warm sentence or two; set "emph":true on at most one fragment to highlight the most important thing.
- stats: exactly three, in this order: meetings (count of actual MEETINGS only — never count reminders/blocks as meetings), to do (email-task count), flagged (urgent email-task count).
- text: the same brief as a single plain string.
- Reminders/blocks are personal items, not meetings — you may mention them, but never describe them as meetings.
- NEVER open with a time-of-day greeting (no "Good morning", "Good afternoon", "Good evening" — the brief may be read at any hour). Start directly with the substance of the day.
- ALWAYS include am/pm on any time you mention (e.g. "3:00 pm", never "3:00").
Keep it human and brief. Never invent events or emails that were not provided.`

export function userContent(events: FeedEvent[], emailTasks: EmailTask[]): string {
  const meetings = events.filter((e) => e.kind === 'meeting')
  const reminders = events.filter((e) => e.kind !== 'meeting')
  const meetLines = meetings.length
    ? meetings.map((e) => `- ${e.title} @ ${e.start}`).join('\n')
    : '(none)'
  const remLines = reminders.length
    ? reminders.map((e) => `- ${e.title} @ ${e.start}`).join('\n')
    : '(none)'
  const mailLines = emailTasks.length
    ? emailTasks.map((t) => `- ${t.title} (${t.meta})${t.urgent ? ' [urgent]' : ''}`).join('\n')
    : '(none)'
  return `Today's meetings:\n${meetLines}\n\nReminders / blocks (NOT meetings, do not count as meetings):\n${remLines}\n\nEmails needing a reply:\n${mailLines}\n\nCounts — meetings: ${meetings.length}, to do: ${emailTasks.length}, flagged: ${emailTasks.filter((t) => t.urgent).length}.`
}

export function validateBrief(obj: unknown): Brief {
  const b = obj as Brief
  if (!b || !Array.isArray(b.runs) || !Array.isArray(b.stats) || typeof b.text !== 'string') {
    throw new Error('brief: response did not match Brief shape')
  }
  if (b.stats.length !== 3 || !b.runs.every((r) => typeof r?.text === 'string')) {
    throw new Error('brief: invalid runs/stats')
  }
  return b
}
