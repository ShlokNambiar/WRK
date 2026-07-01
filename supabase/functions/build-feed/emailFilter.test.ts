import { test } from 'node:test'
import assert from 'node:assert/strict'
import { senderAddress, isBulkOrAutomated, partitionCandidates } from './emailFilter.ts'

test('senderAddress extracts a lowercased address from various From formats', () => {
  assert.equal(senderAddress('Sarah Chen <Sarah@X.com>'), 'sarah@x.com')
  assert.equal(senderAddress('bob@y.com'), 'bob@y.com')
  assert.equal(senderAddress('<a@b.com>'), 'a@b.com')
  assert.equal(senderAddress(undefined), '')
})

test('isBulkOrAutomated flags unsubscribe + no-reply, passes real people', () => {
  assert.equal(isBulkOrAutomated({ threadId: '1', from: 'News <n@brand.com>', listUnsubscribe: '<x>' }), true)
  assert.equal(isBulkOrAutomated({ threadId: '2', from: 'no-reply@s.com' }), true)
  assert.equal(isBulkOrAutomated({ threadId: '3', from: 'Priya <priya@co.com>' }), false)
})

test('partitionCandidates: mute drops, allow force-keeps (even bulk), rest undecided', () => {
  const cands = [
    { threadId: 'm', from: 'Muted <spam@x.com>' },
    { threadId: 'a', from: 'Allowed <alerts@bank.com>', listUnsubscribe: '<u>' }, // allow beats bulk rule
    { threadId: 'b', from: 'Newsletter <n@brand.com>', listUnsubscribe: '<u>' },  // cheap-rule drop
    { threadId: 'p', from: 'Priya <priya@co.com>' },                              // undecided -> AI
  ]
  const mute = new Set(['spam@x.com'])
  const allow = new Set(['alerts@bank.com'])
  const { allow: kept, undecided } = partitionCandidates(cands, mute, allow)
  assert.deepEqual(kept.map((c) => c.threadId), ['a'])
  assert.deepEqual(undecided.map((c) => c.threadId), ['p'])
})
