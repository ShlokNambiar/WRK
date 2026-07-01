import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyActionable } from './actionability.ts'

function fakeGemini(text: string, status = 200) {
  const calls: any[] = []
  const fn = async (_url: string, init?: any) => {
    calls.push({ body: init ? JSON.parse(init.body) : null })
    return { ok: status < 400, status, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }
  }
  return { fn: fn as unknown as typeof fetch, calls }
}

const cands = [
  { threadId: 'a', subject: 'Re: contract', from: 'Sarah <s@x.com>' },
  { threadId: 'b', subject: 'You have done a UPI txn', from: 'HDFC Alerts <alerts@hdfc.net>' },
  { threadId: 'c', subject: 'Quick question', from: 'Priya <p@co.com>' },
]

test('classifyActionable keeps only the indices the model marks as needing a reply', async () => {
  const { fn } = fakeGemini('{"reply":[0,2]}')
  const kept = await classifyActionable(cands, { gemini: 'k' }, fn)
  assert.deepEqual(kept.map((c) => c.threadId), ['a', 'c'])
})

test('classifyActionable returns [] for no candidates without calling the model', async () => {
  let called = false
  const fn = (async () => { called = true; return { ok: true, status: 200, json: async () => ({}) } }) as unknown as typeof fetch
  const kept = await classifyActionable([], { gemini: 'k' }, fn)
  assert.deepEqual(kept, [])
  assert.equal(called, false)
})

test('classifyActionable throws on malformed model output (caller falls back)', async () => {
  const { fn } = fakeGemini('not json at all')
  await assert.rejects(() => classifyActionable(cands, { gemini: 'k' }, fn))
})

test('classifyActionable throws when no provider key is configured', async () => {
  const fn = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
  await assert.rejects(() => classifyActionable(cands, {}, fn))
})
