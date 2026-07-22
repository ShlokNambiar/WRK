# WRK — Handoff: the steps only you can do

Updated 2026-07-22, after the production-readiness audit + fix pass. Everything
in the codebase is built and tested; a **signed release AAB already exists**.
The items below need **your** accounts — ordered by what actually blocks the
beta.

> **Where to put secrets:** Supabase Edge Function secrets live in the dashboard
> at **Project → Edge Functions → Manage secrets** (or `supabase secrets set`).
> Never put any of these in the repo. Local secrets live in
> `C:\Users\shlok\wrk-secrets.local.txt` and `C:\Users\shlok\wrk-keys\` —
> both OUTSIDE the repo.

---

## 0. Deploy the audit-fix backend · ~5 min · **BLOCKS everything server-side**

Migration `0009_security_hardening.sql` and four edge functions (`build-feed`,
`store-token`, `rc-webhook`, **new: `delete-account`**) are written but NOT yet
deployed — the Supabase MCP connection dropped mid-session. Either reconnect
the MCP in Claude Code (`/mcp`) and ask Claude to deploy, or:

```bash
npx supabase login
npx supabase link --project-ref qztghidtbaucvknavjon
npx supabase db push
npx supabase functions deploy build-feed store-token rc-webhook delete-account
```

0009 also **drops the legacy `set_feed` RPC + `feed` table** — the last
anon-reachable write path (cutover cleanup, now mandatory). After deploying,
also delete the old Windows scheduled task "WRK Daily Feed" and `scripts/`.

## 1. Enable GitHub Pages · ~1 min · **BLOCKS Play review**

Repo **Settings → Pages → Deploy from a branch → `main` / `docs`**. That makes
these live (the app + Play console already point at them):

- Privacy policy → `https://shloknambiar.github.io/WRK/PRIVACY.html`
- Account-deletion page (Play requires this URL) → `https://shloknambiar.github.io/WRK/delete-account.html`

## 2. Google Play Console · ~30 min · $25 one-time

- Create the app (package `com.metis.wrk`), **Internal testing** track.
- Upload the **already-signed** AAB:
  `android/app/build/outputs/bundle/release/app-release.aab`
  (keystore: `C:\Users\shlok\wrk-keys\wrk-release.keystore`, credentials in
  `KEYSTORE-INFO.txt` next to it — never commit that folder. Enroll in Play
  App Signing when prompted.)
- **Data safety form** — declare truthfully: personal info (Google identity),
  calendar events, email metadata (subject+sender, Pro), user content (tasks),
  auth tokens server-side encrypted; third-party sharing: AI provider
  (Gemini/Anthropic — titles/subjects only), RevenueCat (purchases);
  all data encrypted in transit; **deletion available** (in-app + the URL from
  step 1).
- Add your testers' Gmail addresses.

## 3. Google OAuth verification (CASA) · separate track, weeks

`gmail.readonly` is a **restricted** scope → Google requires a security
assessment before the app works for users outside your ≤100 test users. Start
this early at [console.cloud.google.com](https://console.cloud.google.com) →
OAuth consent screen → publishing. Until then: test users only (the app warns
them about the unverified screen).

## 4. Waitlist · ~10 min

Tally form (email + "Android?") → export → paste into the OAuth test-users
allowlist (up to 100).

## 5. RevenueCat · ~30 min · _defer past beta_

Everyone is Pro during beta (server-side grant), so billing can wait.
When ready: create the project + `pro` entitlement, put the public SDK key in
`src/lib/billing.js` (`RC_PUBLIC_KEY`), set webhook →
`https://qztghidtbaucvknavjon.supabase.co/functions/v1/rc-webhook` with the
`RC_WEBHOOK_SECRET` edge secret. The UI auto-reveals its upgrade CTAs the
moment `RC_PUBLIC_KEY` is set (`billingReady()`).
**Before public (non-beta) launch:** change the signup trigger's beta Pro grant
(`0002_signup_trigger.sql`) to `free`, or every future signup is Pro forever.

## 6. Optional but recommended

- **ANTHROPIC_API_KEY** edge secret — swaps the brief from free-tier Gemini
  (which may train on sent metadata) to Claude (which doesn't). No redeploy
  needed; also update the privacy policy's AI-provider paragraph when you do.
- **Crash reporting** (Sentry) — the app now has an error boundary, but no
  telemetry: field crashes are invisible.

---

## Native OAuth (reference — already done & verified on device)

Deep link `com.metis.wrk://auth` (manifest intent-filter + `appUrlOpen` +
PKCE `exchangeCodeForSession`). Supabase → Auth → URL Configuration must keep
`com.metis.wrk://auth` in the Redirect URLs allowlist.

## Build reference

```bash
cd C:\Users\shlok\wrk-app
npm run build && npx cap sync android
# note: cap sync regenerates android/app/src/main/res/xml/config.xml and
# re-adds <access origin="*"/> — remove that line again before release builds
cd android && JAVA_HOME="C:\Program Files\Java\jdk-23" ./gradlew bundleRelease
```

JDK 23 required (PATH has 17; Capacitor 8 needs 21+). `android/local.properties`
needs forward slashes. Release signing reads `android/key.properties`
(gitignored).

## What's already done (no action needed)

- 2026-07-22 audit fix pass: offline cache actually used (no more demo-data
  swap), error boundary + cache-clear recovery, token-sync retry + "setup
  didn't finish" flow, honest email-tasks toggle (enforced server-side),
  account deletion (in-app + edge function + web page), deletion tombstones in
  the cloud backup (no resurrecting tasks), sign-out flushes the backup +
  cancels notifications, auto-build on first sign-in and after reconnect,
  pull-to-refresh, first-run intro, portrait lock, release signing + R8,
  `allowBackup=false`, rate-limit hardening, `user_state` size cap, tz
  validation, fetch timeouts, timing-safe webhook, WCAG contrast fixes, focus
  management, 94 automated tests (70 backend + 24 frontend).
- Tables + per-user RLS; `google_tokens` deny-all; Vault-encrypted tokens;
  hourly tz-aware cron (`wrk-hourly-feed`); Google OAuth client + Gemini key
  live; feed verified end-to-end on device.
