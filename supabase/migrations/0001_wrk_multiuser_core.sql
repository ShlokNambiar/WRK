-- WRK multi-user core schema + RLS
-- profiles: one row per auth user
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  tz text default 'Asia/Kolkata',
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select using (auth.uid() = id);

-- entitlements: free vs pro
create table if not exists public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free','pro')),
  source text,
  updated_at timestamptz default now()
);
alter table public.entitlements enable row level security;
drop policy if exists "own entitlement read" on public.entitlements;
create policy "own entitlement read" on public.entitlements for select using (auth.uid() = user_id);

-- feeds: ONLY place feed data lives; derived, never raw
create table if not exists public.feeds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  generated_at timestamptz,
  needs_reauth boolean default false,
  updated_at timestamptz default now()
);
alter table public.feeds enable row level security;
drop policy if exists "own feed read" on public.feeds;
create policy "own feed read" on public.feeds for select using (auth.uid() = user_id);

-- google_tokens: service-role ONLY, no client policy (RLS on, zero policies = deny all)
create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_secret_id uuid,
  scopes text[] not null default '{}',
  updated_at timestamptz default now()
);
alter table public.google_tokens enable row level security;
