-- Per-user brief hour + hourly cron.
-- Everyone used to build at 01:00 UTC (06:30 IST) regardless of timezone. Now
-- each user picks a local hour (profiles.brief_hour); the cron fires HOURLY and
-- build-feed itself (mode:"hourly") selects the users whose current local hour
-- (from profiles.tz) equals their brief_hour.

-- 1. the setting: 0-23, default 7 (7 AM local)
alter table public.profiles add column if not exists brief_hour int not null default 7;
alter table public.profiles drop constraint if exists profiles_brief_hour_check;
alter table public.profiles add constraint profiles_brief_hour_check check (brief_hour between 0 and 23);

-- 2. let a user change their own setting (0001 only granted select). USING +
-- WITH CHECK both pin id = auth.uid(), so a user can neither update another
-- row nor re-point their row at another id.
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- 3. replace the daily job with an hourly one. Same Vault-auth pattern as 0005:
-- URL + service-role key are read from Vault at call time, no secret in the repo.
select cron.unschedule('wrk-daily-feed') where exists (select 1 from cron.job where jobname = 'wrk-daily-feed');
select cron.unschedule('wrk-hourly-feed') where exists (select 1 from cron.job where jobname = 'wrk-hourly-feed');

select cron.schedule(
  'wrk-hourly-feed',
  '0 * * * *',  -- top of every hour; build-feed filters by each user's local hour
  $$
  select net.http_post(
    url := coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'project_url'), '') || '/functions/v1/build-feed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'), '')
    ),
    body := '{"mode":"hourly"}'::jsonb
  );
  $$
);
