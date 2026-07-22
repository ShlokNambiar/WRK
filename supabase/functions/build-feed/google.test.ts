import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weekBounds, mintAccessToken, fetchWeekEvents, fetchActionableUnread, TokenRevokedError } from './google.ts'

// fake fetch helper: routes by URL substring
function fakeFetch(routes: { match: string; status?: number; json: unknown }[]) {
  const calls: { url: string; init?: any }[] = []
  const fn = async (url: string, init?: any) => {
    calls.push({ url: String(url), init })
    const r = routes.find((x) => String(url).includes(x.match))
    if (!r) throw new Error('no route for ' + url)
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.json }
  }
  return { fn: fn as unknown as typeof fetch, calls }
}

test('weekBounds computes a 7-day IST window with +05:30 offset', () => {
  // 2026-07-01T01:00:00Z == 06:30 IST on 2026-07-01
  const b = weekBounds(new Date('2026-07-01T01:00:00Z'), 'Asia/Kolkata')
  assert.equal(b.date, '2026-07-01')
  assert.equal(b.timeMin, '2026-07-01T00:00:00+05:30')
  assert.equal(b.timeMax, '2026-07-08T00:00:00+05:30')
})

test('weekBounds starts on the LOCAL today, not the UTC date', () => {
  // 2026-07-01T20:00:00Z is already 2026-07-02 01:30 IST
  const b = weekBounds(new Date('2026-07-01T20:00:00Z'), 'Asia/Kolkata')
  assert.equal(b.date, '2026-07-02')
  assert.equal(b.timeMin, '2026-07-02T00:00:00+05:30')
  assert.equal(b.timeMax, '2026-07-09T00:00:00+05:30')
})

test('mintAccessToken returns the access token on success', async () => {
  const { fn, calls } = fakeFetch([{ match: 'oauth2.googleapis.com/token', json: { access_token: 'AT123', expires_in: 3599 } }])
  const tok = await mintAccessToken('refresh_xyz', 'cid', 'csecret', fn)
  assert.equal(tok, 'AT123')
  assert.match(calls[0].init.body, /grant_type=refresh_token/)
  assert.match(calls[0].init.body, /refresh_token=refresh_xyz/)
})

test('mintAccessToken throws TokenRevokedError on invalid_grant', async () => {
  const { fn } = fakeFetch([{ match: 'oauth2.googleapis.com/token', status: 400, json: { error: 'invalid_grant' } }])
  await assert.rejects(() => mintAccessToken('bad', 'cid', 'csec', fn), TokenRevokedError)
})

test('fetchWeekEvents calls Calendar API with auth + a 7-day window', async () => {
  const { fn, calls } = fakeFetch([{ match: 'calendar/v3/calendars/primary/events', json: { items: [{ id: 'e1', summary: 'M' }] } }])
  const raw = await fetchWeekEvents('AT', 'Asia/Kolkata', new Date('2026-07-01T01:00:00Z'), fn)
  assert.deepEqual(raw.items, [{ id: 'e1', summary: 'M' }])
  assert.equal(calls[0].init.headers.Authorization, 'Bearer AT')
  assert.match(calls[0].url, /timeMin=2026-07-01T00%3A00%3A00%2B05%3A30/)
  assert.match(calls[0].url, /timeMax=2026-07-08T00%3A00%3A00%2B05%3A30/)
  assert.match(calls[0].url, /singleEvents=true/)
})

test('every google fetch carries an abort-timeout signal (hung endpoint cannot stall a build)', async () => {
  const { fn, calls } = fakeFetch([
    { match: 'oauth2.googleapis.com/token', json: { access_token: 'AT' } },
    { match: 'calendar/v3/calendars/primary/events', json: { items: [] } },
    { match: '/messages?', json: { messages: [{ id: 'm1', threadId: 't1' }] } },
    { match: '/messages/m1', json: { threadId: 't1', payload: { headers: [] } } },
  ])
  await mintAccessToken('r', 'cid', 'csec', fn)
  await fetchWeekEvents('AT', 'Asia/Kolkata', new Date('2026-07-01T01:00:00Z'), fn)
  await fetchActionableUnread('AT', fn)
  assert.equal(calls.length, 4)
  for (const c of calls) assert.ok(c.init.signal instanceof AbortSignal, 'missing signal on ' + c.url)
})

test('fetchActionableUnread lists then fetches METADATA only (never full body)', async () => {
  const { fn, calls } = fakeFetch([
    { match: '/messages?', json: { messages: [{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't2' }] } },
    { match: '/messages/m1', json: { threadId: 't1', payload: { headers: [{ name: 'Subject', value: 'Contract' }, { name: 'From', value: 'Sarah <s@x.com>' }] } } },
    { match: '/messages/m2', json: { threadId: 't2', payload: { headers: [{ name: 'Subject', value: 'Q3' }, { name: 'From', value: 'p@x.com' }, { name: 'List-Unsubscribe', value: '<mailto:u@x.com>' }] } } },
  ])
  const out = await fetchActionableUnread('AT', fn)
  assert.equal(out.messages.length, 2)
  assert.deepEqual(out.messages[0], { threadId: 't1', subject: 'Contract', from: 'Sarah <s@x.com>', listUnsubscribe: '' })
  // the List-Unsubscribe header is captured so the noise filter can use it
  assert.equal(out.messages[1].listUnsubscribe, '<mailto:u@x.com>')
  // privacy: every per-message fetch must request format=metadata, never full
  for (const c of calls.filter((c) => c.url.includes('/messages/'))) {
    assert.match(c.url, /format=metadata/)
    assert.ok(!c.url.includes('format=full'))
  }
  // metadata request asks for the List-Unsubscribe header
  assert.match(calls[1].url, /metadataHeaders=List-Unsubscribe/)
  // list query carries the actionable filter
  assert.match(calls[0].url, /is%3Aunread/)
})
