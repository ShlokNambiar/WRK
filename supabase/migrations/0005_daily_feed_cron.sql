-- Daily build-feed cron. Reads the function URL + service-role key from Vault at
-- call time, so NO secret lives in this migration or the repo. The service_role_key
-- Vault secret is added during handoff (see docs/superpowers/plans HANDOFF):
--   select vault.create_secret('<service_role_key>', 'service_role_key');
-- project_url is seeded at deploy time (non-secret).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('wrk-daily-feed') where exists (select 1 from cron.job where jobname = 'wrk-daily-feed');

select cron.schedule(
  'wrk-daily-feed',
  '0 1 * * *',  -- 01:00 UTC == 06:30 IST
  $$
  select net.http_post(
    url := coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'project_url'), '') || '/functions/v1/build-feed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
