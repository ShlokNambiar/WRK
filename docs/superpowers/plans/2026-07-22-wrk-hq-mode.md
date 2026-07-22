# WRK HQ Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude-managed personal ops inside Shlok's existing WRK account: an `hq_tasks` table Claude writes, merged into the feed with an HQ badge, reminders via local notifications, done-state written back, orchestrated by a 9:00 IST scheduled cloud agent.

**Architecture:** Service-role-written `hq_tasks` rows → `build-feed` merges `status='open'` rows into `payload.hqTasks` → client renders them in the merged task list (badge + detail sheet), schedules local notifications from `remind_at`, and writes `status` back via an RLS-scoped column-limited UPDATE. Calendar time-blocks need no code (Claude writes `[HQ]` events straight to Google Calendar).

**Tech Stack:** Supabase (Postgres migration, Deno edge function), React (Vite), node:test.

## Global Constraints

- Never use the name "pepl" in anything app-facing; project identity is Metis (`com.metis.wrk`).
- Test suites must stay green: `node --experimental-strip-types --test supabase/functions/build-feed/*.test.ts` and `node --test src/lib/derive.test.js`.
- Match surrounding code style; comments only for constraints code can't show.
- All new SQL follows migrations 0007–0009 conventions (idempotent guards, revoke-from-PUBLIC on definer functions).
- Deployment of migrations/functions is currently gated on Supabase auth (MCP reconnect or `npx supabase login`) — code tasks proceed regardless.

---

### Task 1: Migration 0010 — `hq_tasks`

**Files:**
- Create: `supabase/migrations/0010_hq_tasks.sql`

**Interfaces:**
- Produces: table `public.hq_tasks` (columns as below); RLS: owner SELECT; owner UPDATE restricted to `status`/`updated_at` via column-level GRANT; INSERT/DELETE service-role only.

- [ ] **Step 1: Write the migration**

```sql
-- 0010: hq_tasks — Claude-managed personal tasks/reminders (HQ mode).
-- Written ONLY by the service role (Claude's ops sessions / scheduled agent).
-- The owner can read their rows and flip status (done/dismissed) from the app;
-- column-level grants stop them editing titles/times (Claude's fields).
create table if not exists public.hq_tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) <= 200),
  note        text not null default '',
  why         text not null default '',
  due_date    date,
  remind_at   timestamptz,
  urgent      boolean not null default false,
  status      text not null default 'open' check (status in ('open','done','dismissed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.hq_tasks enable row level security;

drop policy if exists "own hq_tasks select" on public.hq_tasks;
create policy "own hq_tasks select" on public.hq_tasks
  for select using (auth.uid() = user_id);

drop policy if exists "own hq_tasks status update" on public.hq_tasks;
create policy "own hq_tasks status update" on public.hq_tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Column-level: authenticated may update ONLY status/updated_at.
revoke update on public.hq_tasks from anon, authenticated;
grant select on public.hq_tasks to authenticated;
grant update (status, updated_at) on public.hq_tasks to authenticated;

create index if not exists hq_tasks_user_open_idx
  on public.hq_tasks (user_id) where status = 'open';
```

- [ ] **Step 2: Sanity-check the SQL parses** — `node -e "require('fs').readFileSync('supabase/migrations/0010_hq_tasks.sql','utf8')"` (syntax is verified at deploy; visual review here).
- [ ] **Step 3: Commit** — `git add supabase/migrations/0010_hq_tasks.sql && git commit -m "feat(hq): hq_tasks table + RLS (migration 0010)"`

### Task 2: build-feed merges hqTasks

**Files:**
- Modify: `supabase/functions/build-feed/buildPayload.ts` (add pure mapper + payload field)
- Modify: `supabase/functions/build-feed/index.ts` (fetch rows, pass through)
- Test: `supabase/functions/build-feed/buildPayload.test.ts`

**Interfaces:**
- Produces: `mapHqTasks(rows: HqRow[], todayKey: string): HqTask[]` exported from buildPayload.ts; payload gains `hqTasks: HqTask[]` where `HqTask = { id: 'hq:'+uuid, title, source: 'HQ', meta: string, note, why, dueDate: string|null, remindAt: string|null, urgent, bucket: 'overdue'|'today'|'week' }`.

- [ ] **Step 1: Write failing tests** (append to buildPayload.test.ts, style-matched):

```ts
describe('mapHqTasks', () => {
  const row = (over = {}) => ({
    id: 'aaaaaaaa-0000-0000-0000-000000000001', title: 'Refresh Upstox token',
    note: 'expires 03:30', why: 'trading day prep', due_date: '2026-07-22',
    remind_at: '2026-07-22T21:00:00+05:30', urgent: false, status: 'open', ...over,
  });
  it('maps an open row to an hq: task with bucket from due_date', () => {
    const [t] = mapHqTasks([row()], '2026-07-22');
    assert.equal(t.id, 'hq:aaaaaaaa-0000-0000-0000-000000000001');
    assert.equal(t.source, 'HQ');
    assert.equal(t.bucket, 'today');
    assert.equal(t.dueDate, '2026-07-22');
    assert.equal(t.why, 'trading day prep');
  });
  it('buckets past due as overdue and future as week; null due -> today', () => {
    assert.equal(mapHqTasks([row({ due_date: '2026-07-20' })], '2026-07-22')[0].bucket, 'overdue');
    assert.equal(mapHqTasks([row({ due_date: '2026-07-25' })], '2026-07-22')[0].bucket, 'week');
    assert.equal(mapHqTasks([row({ due_date: null })], '2026-07-22')[0].bucket, 'today');
  });
  it('drops non-open rows', () => {
    assert.equal(mapHqTasks([row({ status: 'done' })], '2026-07-22').length, 0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`mapHqTasks is not defined`).
- [ ] **Step 3: Implement in buildPayload.ts**:

```ts
// Claude-managed HQ tasks (spec: docs/superpowers/specs/2026-07-22-wrk-hq-mode-design.md).
// Rows are service-role-written; only open ones reach the feed.
export type HqRow = {
  id: string; title: string; note: string; why: string;
  due_date: string | null; remind_at: string | null;
  urgent: boolean; status: string;
};
export function mapHqTasks(rows: HqRow[], todayKey: string) {
  return rows
    .filter((r) => r.status === 'open')
    .map((r) => ({
      id: `hq:${r.id}`,
      title: r.title,
      source: 'HQ' as const,
      meta: 'planned by Claude',
      note: r.note || '',
      why: r.why || '',
      dueDate: r.due_date,
      remindAt: r.remind_at,
      urgent: !!r.urgent,
      bucket: !r.due_date ? 'today' : r.due_date < todayKey ? 'overdue' : r.due_date > todayKey ? 'week' : 'today',
    }));
}
```

- [ ] **Step 4: Wire in index.ts** — in `buildForUser`, after email tasks: select `id,title,note,why,due_date,remind_at,urgent,status` from `hq_tasks` where `user_id = u.id and status = 'open'` (service client, `.limit(50)`, order `due_date asc nulls last`); `const hqTasks = mapHqTasks(rows ?? [], dayKey)` (reuse the tz-local `dayKey` already computed there); include `hqTasks` in the assembled payload next to `emailTasks`. A select error → `hqTasks = []` (never fail the build over HQ).
- [ ] **Step 5: Run suite — expect 73+ pass, 0 fail.**
- [ ] **Step 6: Commit** — `git commit -m "feat(hq): build-feed merges open hq_tasks into payload.hqTasks"`

### Task 3: Client — status write-back helper

**Files:**
- Modify: `src/lib/cloud.js`

**Interfaces:**
- Produces: `setHqTaskStatus(hqId: string, status: 'open'|'done'|'dismissed') → Promise<boolean>`; accepts the `hq:<uuid>` app id and strips the prefix.

- [ ] **Step 1: Implement** (below the email-rules block, matching style):

```js
// ---- HQ tasks (Claude-managed; see docs/superpowers/specs/2026-07-22-wrk-hq-mode-design.md) ----
// The app may only flip status (column-level grant); rows are Claude-written.
export async function setHqTaskStatus(hqId, status) {
  try {
    const id = String(hqId).startsWith('hq:') ? String(hqId).slice(3) : String(hqId)
    const { error } = await supabase.from('hq_tasks')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
    return !error
  } catch {
    return false
  }
}
```

- [ ] **Step 2: `npm run build` passes. Commit** — `git commit -m "feat(hq): setHqTaskStatus write-back"`

### Task 4: Client — hqTasks in the day model (+ reminders, status sync)

**Files:**
- Modify: `src/hooks/useDayModel.js`

**Interfaces:**
- Consumes: `feed.hqTasks` (Task 2 shape), `setHqTaskStatus` (Task 3), existing `scheduleTaskReminder`/`cancelTaskReminder`, `dueLabel`.
- Produces: hq tasks appear in `tasks`/`grouped` with `due` labels; toggling an `hq:` id also writes status; reminders scheduled from feed.

- [ ] **Step 1: Map hqTasks** — next to the `emailTasks` memo:

```js
// Claude-managed HQ tasks: always the user's own (no tier gate). due labels
// are computed like manual tasks so rollover buckets stay correct.
const hqTasks = useMemo(() => {
  const raw = Array.isArray(feed?.hqTasks) ? feed.hqTasks : []
  return raw.map((t) => ({ ...t, due: t.dueDate ? dueLabel(t.dueDate, now) : 'today' }))
}, [feed, now])
```

Include in the merge: `mergeTasks([...autoTasks, ...emailTasks, ...hqTasks], …)` (add `hqTasks` to that memo's dep array).

- [ ] **Step 2: Status write-back in toggleTask** — after the flip logic, outside the setState updater (updaters must stay pure):

```js
const toggleTask = useCallback((id) => {
  let nowDone = false
  setDoneById((d) => {
    const next = { ...d }
    if (next[id]) delete next[id]
    else { next[id] = Date.now(); nowDone = true; cancelTaskReminder(id) }
    return next
  })
  // HQ tasks report status back so the morning run knows what happened.
  // (queueMicrotask: read nowDone after the sync setState pass, keep updater pure)
  if (id.startsWith('hq:')) queueMicrotask(() => setHqTaskStatus(id, nowDone ? 'done' : 'open'))
}, [])
```

(Note: React 18 runs updaters synchronously before the microtask in the common case; StrictMode double-invoke is tolerated because `setHqTaskStatus` is idempotent per value.)

- [ ] **Step 3: Reminders from feed** — new effect after the notifications effects:

```js
// Schedule local notifications for Claude-set reminders delivered in the feed.
useEffect(() => {
  if (notifStatus !== 'granted') return
  for (const t of hqTasks) {
    if (doneById[t.id]) { cancelTaskReminder(t.id); continue }
    if (t.remindAt && new Date(t.remindAt) > new Date()) {
      scheduleTaskReminder({ id: t.id, title: t.title, remindAt: t.remindAt })
    }
  }
}, [hqTasks, notifStatus, doneById])
```

- [ ] **Step 4: Dismissal support** — export a `dismissHqTask(id)` on the returned object: `toggleTask(id)` + `setHqTaskStatus(id, 'dismissed')`; undo path is `toggleTask(id)` + `setHqTaskStatus(id, 'open')`. Concretely:

```js
const dismissHqTask = useCallback((id) => {
  setDoneById((d) => ({ ...d, [id]: Date.now() }))
  cancelTaskReminder(id)
  setHqTaskStatus(id, 'dismissed')
}, [])
const undoDismissHqTask = useCallback((id) => {
  setDoneById((d) => { const n = { ...d }; delete n[id]; return n })
  setHqTaskStatus(id, 'open')
}, [])
```

Add both to the return object.

- [ ] **Step 5: `npm run build` + `node --test src/lib/derive.test.js` green. Commit** — `git commit -m "feat(hq): hq tasks in day model — merge, reminders, status write-back"`

### Task 5: Client — badge + detail sheet

**Files:**
- Modify: `src/components/TaskRow.jsx` (SOURCE map only)
- Modify: `src/screens/TaskDetailSheet.jsx`

**Interfaces:**
- Consumes: task shape from Task 4 (`source: 'HQ'`, `why`, `note`), `day.dismissHqTask`/`day.undoDismissHqTask`.

- [ ] **Step 1: Badge** — add to `SOURCE` in TaskRow.jsx (contrast ≥4.5:1 on its bg — verify with the same relative-luminance math used in the audit):

```js
HQ: { fg: '#4a35c9', bg: '#e9e6fa' },
```

- [ ] **Step 2: Detail sheet** — in TaskDetailSheet.jsx: `const isHq = task.source === 'HQ'`; subtitle line becomes `{isHq ? 'Planned by Claude' : task.source === 'Email' ? 'Drafted from your inbox' : 'Drafted from your calendar'} · {task.meta}`; render the reasoning under it when present:

```jsx
{isHq && task.why && (
  <div style={{ fontSize: 13, lineHeight: 1.5, color: C.inkSoft, background: '#f3f2ec', borderRadius: 12, padding: '10px 13px', marginBottom: 14 }}>
    <b style={{ fontWeight: 600 }}>Why:</b> {task.why}
  </div>
)}
```

The Dismiss button branches: `isHq ? (day.dismissHqTask(task.id), snack with Undo → day.undoDismissHqTask(task.id)) : existing toggle-based dismiss`. Mark done stays `day.toggleTask` (Task 4 already syncs status for `hq:` ids).

- [ ] **Step 3: `npm run build` green. Commit** — `git commit -m "feat(hq): HQ badge + detail sheet with Claude's why"`

### Task 6: Deploy + end-to-end seed test

**Files:** none (ops)

- [ ] **Step 1:** Deploy migrations 0009+0010 and functions `build-feed`, `store-token`, `rc-webhook`, `delete-account` (Supabase MCP or CLI — gated on auth; see Global Constraints).
- [ ] **Step 2:** Seed one row for Shlok's user id with the service key (REST insert), POST build-feed for him, `adb` screenshot: task appears with HQ badge; tap → detail shows "why"; Mark done → row `status='done'` (verify via REST select); next rebuild drops it.
- [ ] **Step 3:** Commit any fixups.

### Task 7: Vault → private GitHub repo

**Files:** `C:\HQ\Shlok's Vault` (outside wrk-app)

- [ ] **Step 1:** `git init`, add `.gitignore` (`.obsidian/workspace*`, `.trash/`), initial commit.
- [ ] **Step 2:** Shlok creates the **private** repo `hq-vault` on GitHub (30 s, needs his login) → `git remote add origin … && git push -u origin main`.

### Task 8: Scheduled cloud agent (9:00 IST) + first-run test

**Files:** none (schedule skill registration)

- [ ] **Step 1:** Register via the `schedule` skill: daily cron `30 3 * * *` UTC (= 9:00 IST), prompt = the morning-run procedure (read calendar+VIP mail+open/yesterday hq_tasks+vault repo → plan → write hq_tasks rows via service key + `[HQ]` calendar blocks → commit brief to vault repo). Authority rules embedded verbatim: *create freely; modify/delete only `[HQ]`-tagged items; never touch human events.*
- [ ] **Step 2:** Trigger once manually; verify which tools attached (calendar? gmail? repo?). Record results; if calendar tools absent headless, note fallback (hq_tasks-only) in the routine prompt.

### Task 9: Audit pass (requested)

- [ ] Dispatch a read-only audit subagent over the HQ diff: RLS escape attempts on `hq_tasks` (can an owner edit `title`? insert? read others' rows?), feed-merge crash paths (malformed hqTasks payload on old clients), reminder scheduling races (done → cancel ordering), status write-back failure modes, and the routine's authority-rule wording. Fix confirmed findings; re-run both suites; commit.
