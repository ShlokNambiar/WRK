import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claudeBrief } from './claudeBrief.ts'

function fakeAnthropic(text: string, status = 200) {
  const calls: any[] = []
  const fn = async (_url: string, init?: any) => {
    calls.push({ init, body: init ? JSON.parse(init.body) : null })
    return { ok: status < 400, status, json: async () => ({ content: [{ type: 'text', text }] }) }
  }
  return { fn: fn as unknown as typeof fetch, calls }
}

const events = [{ id: 'e1', title: 'Design review', start: '2026-07-01T11:00:00+05:30' }] as any
const emailTasks = [{ id: 'mail:t1', title: 'Reply: Contract', meta: 'from Sarah', urgent: true }] as any

test('claudeBrief parses a valid Anthropic JSON response into a Brief', async () => {
  const payload = JSON.stringify({
    runs: [{ text: 'One meeting today.' }, { text: 'a contract needs a reply', emph: true }],
    stats: [{ n: '1', label: 'meetings' }, { n: '1', label: 'to do' }, { n: '1', label: 'flagged' }],
    text: 'One meeting today and a contract needs a reply.',
  })
  const { fn, calls } = fakeAnthropic(payload)
  const brief = await claudeBrief(events, emailTasks, 'sk-test', fn)
  assert.equal(brief.stats.length, 3)
  assert.equal(brief.runs[1].emph, true)
  assert.equal(typeof brief.text, 'string')
  // uses Haiku, correct endpoint + auth header, no effort/thinking params
  assert.match(calls[0].init.headers['x-api-key'], /sk-test/)
  assert.equal(calls[0].body.model, 'claude-haiku-4-5')
  assert.equal(calls[0].body.output_config, undefined)
  assert.equal(calls[0].body.thinking, undefined)
})

test('claudeBrief throws on malformed JSON (caller falls back to template)', async () => {
  const { fn } = fakeAnthropic('not json at all')
  await assert.rejects(() => claudeBrief(events, emailTasks, 'sk-test', fn))
})

test('claudeBrief throws on a wrong-shaped object', async () => {
  const { fn } = fakeAnthropic(JSON.stringify({ runs: 'nope' }))
  await assert.rejects(() => claudeBrief(events, emailTasks, 'sk-test', fn))
})

test('claudeBrief throws on an API error status', async () => {
  const { fn } = fakeAnthropic('{}', 500)
  await assert.rejects(() => claudeBrief(events, emailTasks, 'sk-test', fn))
})
