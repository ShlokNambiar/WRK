# WRK HQ Mode — Claude-managed personal ops

Date: 2026-07-22 · Status: approved (Shlok, in-session)

## What this is

Shlok's WRK account becomes his personal HQ: Claude creates and manages
calendar time-blocks, tasks, and reminders for him — on a schedule and on
demand — inside the same app everyone else uses. **No fork, no branch**: the
feature ships dormant on `main` and activates only for accounts that have HQ
data.

## Decisions made (with Shlok)

1. **Same app, same account** — not a second install, not a long-lived branch.
2. **Cadence**: scheduled morning run at **9:00 IST** via a Claude Code
   **scheduled cloud agent** (no VPS — infra-free, costs only plan usage) +
   on-demand actions in any live session.
3. **Authority — "additive + own items"**: Claude freely creates items and may
   move/delete only items it created (tagged `[HQ]`). Events created by Shlok
   or involving other people are never modified — Claude surfaces a suggestion
   instead.
4. **Reminders — both channels, no double-ping**: time-blocks/events → Google
   Calendar (Google notifies); tasks/reminders → WRK local notifications. Any
   single item uses exactly one channel.

## Architecture

### Channel A — calendar time-blocks (zero app changes)

Claude writes directly to Shlok's Google Calendar via the account-connected
Google Calendar tools. Every Claude-created event has `[HQ]` in the title.
They flow into the WRK feed through the existing build-feed pipeline like any
other event. Guardrail: Claude only ever updates/deletes events whose title
carries the `[HQ]` tag.

### Channel B — tasks & reminders (`hq_tasks` table)

New table (migration 0010):

```sql
create table public.hq_tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) <= 200),
  note        text not null default '',        -- shown in the detail sheet
  why         text not null default '',        -- Claude's reasoning, shown in detail
  due_date    date,                            -- rollover bucketing like manual tasks
  remind_at   timestamptz,                     -- WRK schedules a local notification
  urgent      boolean not null default false,
  status      text not null default 'open' check (status in ('open','done','dismissed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

RLS: owner may `select` own rows and `update` **only** `status`/`updated_at`
(enforced with a trigger or column-level check, mirroring the 0007 style);
insert/delete are service-role only (Claude's write path). Cap: `count`-guard
not needed — Claude is the only writer.

- **Feed merge**: `build-feed` selects the user's `open` hq_tasks and emits
  them in the payload as `hqTasks` (shape parallel to `emailTasks`, ids
  `hq:<uuid>`, `source: 'HQ'`, carrying note/why/due_date/remind_at/urgent).
- **App rendering**: hqTasks join the merged task list with an **HQ ✦ badge**
  (styling parallel to the Email badge). Task detail sheet for `hq:` tasks
  shows note + "why" and offers **Mark done** and **Dismiss**.
- **Done-state closes the loop**: toggling an `hq:` task done (or dismissing)
  performs the normal local `doneById` flip AND updates
  `hq_tasks.status = 'done' | 'dismissed'` via the owner's RLS-scoped update
  (fire-and-forget with the usual silent-failure tolerance; the local flip is
  the source of truth for the UI). The morning run reads statuses to know what
  happened yesterday.
- **Notifications**: on each feed sync the client schedules local
  notifications for open hqTasks with a future `remind_at` (id = hash of task
  id, same registry as manual-task reminders; done/dismissed → cancel).

### Orchestration

- **Morning routine — scheduled cloud agent, 9:00 IST daily.** Reads: Google
  Calendar (today+week), VIP Gmail, open/yesterday's `hq_tasks`, and the HQ
  vault (via its private GitHub repo — see below). Plans the day. Writes: new
  `hq_tasks` rows + `[HQ]` calendar time-blocks, and the morning brief into
  the vault's `Daily/<date>.md`. Prunes: yesterday's done/dismissed rows are
  left as history (no deletion; `status` filter keeps the feed clean).
- **On-demand**: in any live session Shlok can say "block Thursday morning",
  "remind me at 9pm" — Claude writes immediately through the same channels.
- **First-run test**: trigger the routine once manually and verify which
  connected tools attach in the headless environment. Known risk:
  interactively-authenticated connectors (Google Calendar/Gmail) may be absent
  headless. Fallback if so: routine manages `hq_tasks` only (core loop
  intact); calendar writes stay session-only until a direct API path is wired.

### Vault sync

The HQ vault (`C:\HQ\Shlok's Vault`) becomes a **private** GitHub repo so the
cloud agent can clone it for context and write the daily brief back (commit +
push). Side benefit: vault backup. Local Obsidian keeps working on the same
folder; sync is push/pull via git (the routine pushes; the PC pulls when a
local session starts work on the vault).

## Non-goals

- No new app screens; the existing Tasks UI carries HQ items.
- No autonomous rescheduling of Shlok's own items (authority level 1).
- Not multi-user: other accounts simply have zero hq_tasks and see nothing.
- No FCM/push infra; local notifications only, as today.

## Failure modes

- Cloud run misses / errors → nothing breaks; next live session says "morning
  run didn't happen, planning now" and does it inline.
- Status write-back fails → task stays visually done locally (doneById);
  morning run treats still-`open` stale rows older than 48h as "check with
  Shlok" rather than re-reminding.
- Vault repo push conflict → routine commits with `--force-with-lease` never;
  on conflict it writes the brief to a dated side file and flags it.

## Testing

- Unit: hqTasks merge in build-feed (shape, `open`-only, cap ordering);
  RLS: owner cannot update title/insert/delete (SQL tests in migration
  comments or manual verification); client mapping `hq:` → badge/detail.
- End-to-end: seed one hq_task via service key → feed rebuild → appears in
  app with badge → mark done on device → row status flips → next feed drops it.
