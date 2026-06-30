# WRK — Handoff: the steps only you can do

Everything in the codebase is built, deployed, and tested. The items below need
**your** accounts and credentials — I can't do them for you. They're ordered so
you can get a working beta fastest. Times are rough.

> **Where to put secrets:** Supabase Edge Function secrets live in the dashboard
> at **Project → Edge Functions → Manage secrets** (or `supabase secrets set`).
> Never put any of these in the repo.

---

## 1. Google Cloud — OAuth (the big one) · ~30–45 min

1. Create a project at <https://console.cloud.google.com>.
2. **APIs & Services → Enable APIs**: enable **Google Calendar API** and **Gmail API**.
3. **OAuth consent screen**: User type **External**. Fill app name (WRK), support
   email, developer email. Add the homepage + privacy-policy URL (host
   `docs/PRIVACY.md` somewhere public — a GitHub Pages link is fine).
4. **Scopes**: add `.../auth/calendar.readonly` and `.../auth/gmail.readonly`.
5. **Test users**: add the Gmail addresses from your waitlist (up to 100).
6. **Publishing status**: set to **In production** (still unverified). This gives
   long-lived refresh tokens; testers will see a "Google hasn't verified this app"
   screen → **Advanced → Continue** (the app already tells them this).
7. **Credentials → Create OAuth client ID → Web application**. Add the Supabase
   callback as an authorized redirect URI:
   `https://qztghidtbaucvknavjon.supabase.co/auth/v1/callback`.
   Copy the **Client ID** and **Client secret**.

Then:
- **Supabase → Authentication → Providers → Google**: paste Client ID + secret, enable.
- **Supabase Edge Function secrets**: set `GOOGLE_OAUTH_CLIENT_ID` and
  `GOOGLE_OAUTH_CLIENT_SECRET` (the `build-feed` job uses these to refresh tokens).

## 2. Anthropic API key (for the Pro AI brief) · ~5 min

- Create a key at <https://console.anthropic.com>.
- Set Edge Function secret `ANTHROPIC_API_KEY`. (Free-tier users don't use it;
  Pro users' briefs cost ~$0.10–0.15/user/month on claude-haiku-4-5.)

## 3. Turn on the daily cron's credential · ~2 min

The cron is already scheduled (06:30 IST) but reads the service-role key from
Vault. Add it once (run in the **Supabase SQL editor**, NOT in a repo file):

```sql
select vault.create_secret('<YOUR_SERVICE_ROLE_KEY>', 'service_role_key');
```

Your service-role key is in **Supabase → Project Settings → API**. After this,
the daily job authenticates and runs. To test immediately without waiting for
6:30 AM, in the SQL editor run:

```sql
select net.http_post(
  url := 'https://qztghidtbaucvknavjon.supabase.co/functions/v1/build-feed',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
  body := '{}'::jsonb);
```

## 4. RevenueCat (Pro subscriptions) · ~30 min · _can defer past first beta_

- Create a project at <https://app.revenuecat.com>; add your Google Play app.
- Create a subscription product and an **entitlement** with identifier `pro`.
- Put the **public SDK key** into `src/lib/billing.js` (`RC_PUBLIC_KEY`).
- Set a webhook → `https://qztghidtbaucvknavjon.supabase.co/functions/v1/rc-webhook`,
  with an Authorization header value of your choice; set the same value as Edge
  Function secret `RC_WEBHOOK_SECRET`.
- Note: during beta every user is already granted Pro server-side, so you can
  ship the beta **before** finishing billing.

## 5. Build + ship the Android app · ~30 min (needs Android Studio)

```bash
cd C:\Users\shlok\wrk-app
npm run build
npx cap sync android
npx cap open android   # Build → Generate Signed Bundle/APK
```

- **Native OAuth deep link**: confirm `life.pepl.wrk://auth` is registered as an
  intent filter and wire Capacitor's `appUrlOpen` to hand the redirect URL to
  Supabase (`supabase.auth` session exchange). This is the one piece that can
  only be tested on a real device once the Google client (step 1) exists.
- **Google Play Console** ($25 one-time): create the app, **Internal testing**
  track, upload the signed `.aab`, complete the Data safety form (declare
  read-only Calendar/Gmail; "data is not stored" for email content), add testers.

## 6. Waitlist · ~10 min

- Spin up a Tally form (email + "Android?" + "what do you struggle to track?").
- Export emails → paste into the Google test-users allowlist (step 1.5).

---

## Cleanup at cutover (after the new app is verified on your phone)

The old single-user path still exists so your current setup keeps working until
you install the new build. Once the new app works end-to-end, retire it:

```sql
drop function if exists public.set_feed(text, jsonb);
drop table if exists public.feed;
```

and delete the local Windows scheduled task "WRK Daily Feed" + `scripts/`.
This clears the last security-advisor warning (`set_feed` is the only one left,
and it's secret-gated).

---

## What's already done (no action needed)

- All 4 tables + per-user RLS; `google_tokens` locked to service-role only.
- Vault-encrypted token storage; `store-token`, `build-feed`, `rc-webhook` edge
  functions deployed and auth-gated (verified 401 for unauthorized callers).
- Daily cron scheduled (06:30 IST), reads creds from Vault.
- App: Google sign-in, per-user feed read, Free/Pro gating, billing layer.
- 17 unit tests green; build green; SSR render verified; security-audited.
