import { test } from 'node:test'
import assert from 'node:assert/strict'
import { geminiBrief } from './geminiBrief.ts'

function fakeGemini(text: string, status = 200) {
  const calls: any[] = []
  const fn = async (url: string, init?: any) => {
    calls.push({ url, init, body: init ? JSON.parse(init.body) : null })
    return {
      ok: status < 400,
      status,
      json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    }
  }
  return { fn: fn as unknown as typeof fetch, calls }
}

const events = [{ id: 'e1', title: 'Design review', start: '2026-07-01T11:00:00+05:30' }] as any
const emailTasks = [{ id: 'mail:t1', title: 'Reply: Contract', meta: 'from Sarah', urgent: true }] as any

test('geminiBrief parses a valid Gemini JSON response into a Brief', async () => {
  const payload = JSON.stringify({
    runs: [{ text: 'One meeting today.' }, { text: 'a contract needs a reply', emph: true }],
    stats: [{ n: '1', label: 'meetings' }, { n: '1', label: 'to do' }, { n: '1', label: 'flagged' }],
    text: 'One meeting today and a contract needs a reply.',
  })
  const { fn, calls } = fakeGemini(payload)
  const brief = await geminiBrief(events, emailTasks, 'gk-test', fn)
  assert.equal(brief.stats.length, 3)
  assert.equal(brief.runs[1].emph, true)
  assert.equal(typeof brief.text, 'string')
  // uses gemini-2.5-flash, key in header (not URL), JSON mode, thinking off
  assert.match(calls[0].url, /gemini-2\.5-flash/)
  assert.doesNotMatch(calls[0].url, /gk-test/) // key must NOT be in the URL
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'gk-test')
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json')
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingBudget, 0)
})

test('geminiBrief throws on malformed JSON (caller falls back to template)', async () => {
  const { fn } = fakeGemini('not json at all')
  await assert.rejects(() => geminiBrief(events, emailTasks, 'gk-test', fn))
})

test('geminiBrief throws on a wrong-shaped object', async () => {
  const { fn } = fakeGemini(JSON.stringify({ runs: 'nope' }))
  await assert.rejects(() => geminiBrief(events, emailTasks, 'gk-test', fn))
})

test('geminiBrief throws on an API error status', async () => {
  const { fn } = fakeGemini('{}', 500)
  await assert.rejects(() => geminiBrief(events, emailTasks, 'gk-test', fn))
})

test('geminiBrief throws when the response has no candidate text', async () => {
  const calls: any[] = []
  const fn = (async (_url: string, init?: any) => {
    calls.push(init)
    return { ok: true, status: 200, json: async () => ({ candidates: [] }) }
  }) as unknown as typeof fetch
  await assert.rejects(() => geminiBrief(events, emailTasks, 'gk-test', fn))
})
