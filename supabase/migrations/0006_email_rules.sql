-- Per-user email sender rules: the "you curate" layer on top of the AI filter.
-- mode 'mute'  = never make tasks from this sender (drops it, always)
-- mode 'allow' = always make tasks from this sender (keep, even if it looks bulk)
-- Sender is the normalized (lowercased) email address.
create table if not exists public.email_rules (
  user_id    uuid not null references auth.users(id) on delete cascade,
  sender     text not null,
  mode       text not null check (mode in ('mute', 'allow')),
  created_at timestamptz not null default now(),
  primary key (user_id, sender)
);

alter table public.email_rules enable row level security;

-- Users manage only their own rules. The feed builder reads via service_role,
-- which bypasses RLS.
create policy "email_rules select own" on public.email_rules
  for select using (auth.uid() = user_id);
create policy "email_rules insert own" on public.email_rules
  for insert with check (auth.uid() = user_id);
create policy "email_rules update own" on public.email_rules
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "email_rules delete own" on public.email_rules
  for delete using (auth.uid() = user_id);
