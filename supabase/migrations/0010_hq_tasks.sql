-- 0010: hq_tasks — Claude-managed personal tasks/reminders (HQ mode).
-- Spec: docs/superpowers/specs/2026-07-22-wrk-hq-mode-design.md
-- Rows are written ONLY by the service role (Claude's ops sessions / the
-- scheduled morning agent). The owner can read their rows and flip status
-- (done/dismissed) from the app; column-level grants stop them editing
-- titles/times — those are Claude's fields. Dormant for accounts with no rows.
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

-- Column-level: authenticated may update ONLY status. updated_at is stamped
-- by a trigger, not the client — it feeds the morning run's staleness logic,
-- so a client must not be able to forge (or forget) it. No INSERT or DELETE
-- grants — the service role (bypassing RLS) is the only writer.
revoke all on public.hq_tasks from anon;
revoke insert, update, delete on public.hq_tasks from authenticated;
grant select on public.hq_tasks to authenticated;
grant update (status) on public.hq_tasks to authenticated;

create or replace function public.hq_tasks_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.hq_tasks_touch() from public, anon, authenticated;

drop trigger if exists hq_tasks_touch on public.hq_tasks;
create trigger hq_tasks_touch
  before update on public.hq_tasks
  for each row execute function public.hq_tasks_touch();

-- The feed builder reads open rows per user, ordered by due_date.
create index if not exists hq_tasks_user_open_idx
  on public.hq_tasks (user_id, due_date) where status = 'open';
