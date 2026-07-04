-- Cloud backup of local task state (manual tasks + done-state + settings).
-- One jsonb row per user; local-first, pushed debounced from the client and
-- pulled once per sign-in so a reinstall / new phone restores tasks.
create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

create policy "user_state_select_own" on public.user_state
  for select using (auth.uid() = user_id);
create policy "user_state_insert_own" on public.user_state
  for insert with check (auth.uid() = user_id);
create policy "user_state_update_own" on public.user_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_state_delete_own" on public.user_state
  for delete using (auth.uid() = user_id);
