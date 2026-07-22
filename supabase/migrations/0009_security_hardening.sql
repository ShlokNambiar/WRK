-- Security hardening batch (2026-07 backend audit).

-- 1. Drop the legacy single-user feed path (pre-multi-user prototype). set_feed
-- was the last anon-reachable write path left in the schema; multi-user feeds
-- live in public.feeds (service-role writes only), so both go.
drop function if exists public.set_feed(text, jsonb);
drop table if exists public.feed;

-- 2. Size cap on the user_state jsonb blob (256 KB). The client pushes this
-- debounced and unvalidated, so without a cap a hostile/buggy client could grow
-- a row without bound.
alter table public.user_state drop constraint if exists user_state_state_size;
alter table public.user_state add constraint user_state_state_size
  check (pg_column_size(state) < 262144);

-- 3. Length cap on email_rules.sender (320 = the maximum legal email address).
alter table public.email_rules drop constraint if exists email_rules_sender_length;
alter table public.email_rules add constraint email_rules_sender_length
  check (char_length(sender) <= 320);

-- 4. The user-facing "email tasks" switch: when false, build-feed skips the
-- whole Gmail fetch + email pipeline for that user. The "own profile update"
-- policy from 0007 already lets a user update their own row, so no new policy.
alter table public.profiles add column if not exists email_tasks_enabled boolean not null default true;

-- 5. Permissive format guard on profiles.tz — charset + length only, so a
-- write can never park control characters/HTML in the column. Real IANA-zone
-- validation happens in code (safeTz in build-feed; store-token on write).
alter table public.profiles drop constraint if exists profiles_tz_format_check;
alter table public.profiles add constraint profiles_tz_format_check
  check (tz is null or tz ~ '^[A-Za-z0-9_+/-]{1,64}$');

-- 6. Rate-limit stamp for the user-invoked rebuild. Stamped BEFORE any
-- outbound work (updated_at only moved on success, so error paths allowed
-- unlimited retries hammering Google + the AI provider).
alter table public.feeds add column if not exists last_rebuild_at timestamptz;

-- 7. delete_google_token: removes the google_tokens row AND its Vault secret.
-- Backs the delete-account edge function — the Vault secret does not cascade
-- from auth.users, so it must be deleted explicitly. Mirrors store_google_token
-- (0003) and the 0004 EXECUTE hardening: PUBLIC gets EXECUTE by default, so it
-- must be revoked; service_role only.
create or replace function public.delete_google_token(p_user uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select refresh_token_secret_id into v_id from public.google_tokens where user_id = p_user;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
  delete from public.google_tokens where user_id = p_user;
end; $$;

revoke execute on function public.delete_google_token(uuid) from public, anon, authenticated;
grant execute on function public.delete_google_token(uuid) to service_role;
