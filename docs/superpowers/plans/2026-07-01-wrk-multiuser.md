# WRK Multi-User Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild WRK as a multi-user app where each user signs in with Google and a Supabase backend builds their personalised daily feed (calendar + Gmail read-only), gated by a free/Pro tier, shipped to an Android closed beta.

**Architecture:** Supabase Auth (Google OAuth) + Postgres (per-user tokens + derived feed, RLS-isolated) + a scheduled `build-feed` Edge Function that fetches each user's data, builds a brief (Claude API for Pro, template for Free), stores only the derived feed and discards raw content. The existing React/Capacitor app is rewired from "paste a feed URL" to authenticated per-user reads.

**Tech Stack:** React + Vite + framer-motion, Capacitor (Android), `@supabase/supabase-js`, Supabase Edge Functions (Deno/TypeScript), Postgres + pg_cron + pg_net + Vault, Anthropic API (claude-haiku-4-5), RevenueCat (Google Play subscriptions).

## Global Constraints

- Supabase project: `qztghidtbaucvknavjon` (region ap-south-1).
- App ID: `life.pepl.wrk`. Android only this phase; iOS deferred.
- Scopes: `https://www.googleapis.com/auth/calendar.readonly` (all users) + `https://www.googleapis.com/auth/gmail.readonly` (Pro only).
- **Privacy invariant:** raw email/calendar content is NEVER persisted. Only the derived feed payload is stored. Every `build-feed` test must assert raw content never appears in stored output.
- **Feed payload contract (unchanged from current app):** `{ generatedAt, profile:{name,email,avatarUrl}, brief:{runs:[{text,emph?}],stats:[{n,label}x3]}, days:{'<YYYY-MM-DD>':[FeedEvent]}, emailTasks:[...] }`.
- RLS: users read only their own `feeds`/`profiles`/`entitlements` row; `google_tokens` has NO client access (service-role only).
- Secrets live in Edge Function env / Vault, never in the repo. `.env` is gitignored.
- Timezone: per-user; default Asia/Kolkata until a user TZ field exists.
- Beta entitlement: all users granted `pro` via `beta_grant` until public launch.

---

## Phase 1 — Backend foundation (Supabase schema + RLS + token store)

### Task 1.1: Core tables + RLS migration

**Files:**
- Create (via MCP `apply_migration`, name `wrk_multiuser_core`): SQL below
- Mirror to repo: `supabase/migrations/0001_wrk_multiuser_core.sql`

**Produces:** tables `profiles`, `google_tokens`, `entitlements`, `feeds` with RLS.

- [ ] **Step 1:** Apply migration:

```sql
-- profiles: one row per auth user
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  tz text default 'Asia/Kolkata',
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select using (auth.uid() = id);

-- entitlements: free vs pro
create table if not exists public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free','pro')),
  source text,
  updated_at timestamptz default now()
);
alter table public.entitlements enable row level security;
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
create policy "own feed read" on public.feeds for select using (auth.uid() = user_id);

-- google_tokens: service-role ONLY, no client policy (RLS on, zero policies = deny all)
create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_secret_id uuid,        -- points at a Vault secret
  scopes text[] not null default '{}',
  updated_at timestamptz default now()
);
alter table public.google_tokens enable row level security;
-- intentionally NO policies: only service_role (which bypasses RLS) can touch this.
```

- [ ] **Step 2:** Verify with `execute_sql`: `select tablename, rowsecurity from pg_tables where schemaname='public';` — all four show `rowsecurity = true`.
- [ ] **Step 3:** Verify deny-by-default: `select * from pg_policies where tablename='google_tokens';` returns 0 rows.

### Task 1.2: Auto-provision profile + entitlement on signup

**Files:** migration `0002_signup_trigger.sql`

**Produces:** trigger that creates `profiles` + `entitlements(tier='pro', source='beta_grant')` rows when a user signs up.

- [ ] **Step 1:** Apply:

```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
    on conflict (id) do nothing;
  insert into public.entitlements(user_id, tier, source)
    values (new.id, 'pro', 'beta_grant')   -- BETA: everyone Pro
    on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 2:** Verify function exists: `select proname from pg_proc where proname='handle_new_user';`

### Task 1.3: Vault helpers for token storage

**Files:** migration `0003_token_helpers.sql`

**Produces:** `store_google_token(p_user uuid, p_refresh text, p_scopes text[])` and `get_google_refresh(p_user uuid)` — SECURITY DEFINER, service-role callable, encrypt via Vault.

- [ ] **Step 1:** Apply:

```sql
create or replace function public.store_google_token(p_user uuid, p_refresh text, p_scopes text[])
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select refresh_token_secret_id into v_id from public.google_tokens where user_id = p_user;
  if v_id is null then
    v_id := vault.create_secret(p_refresh, 'google_refresh_' || p_user::text);
    insert into public.google_tokens(user_id, refresh_token_secret_id, scopes)
      values (p_user, v_id, p_scopes);
  else
    perform vault.update_secret(v_id, p_refresh);
    update public.google_tokens set scopes = p_scopes, updated_at = now() where user_id = p_user;
  end if;
end; $$;

create or replace function public.get_google_refresh(p_user uuid)
returns text language plpgsql security definer set search_path = public, vault as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where id = (select refresh_token_secret_id from public.google_tokens where user_id = p_user);
  return v_secret;
end; $$;

revoke all on function public.store_google_token(uuid,text,text[]) from anon, authenticated;
revoke all on function public.get_google_refresh(uuid) from anon, authenticated;
```

- [ ] **Step 2:** Verify Vault enabled and functions present.

### Task 1.4: `store-token` Edge Function

**Files:** Create `supabase/functions/store-token/index.ts`

**Interfaces — Produces:** HTTP endpoint; app POSTs `{ provider_refresh_token, scopes }` with the user's Supabase JWT in `Authorization`. Function verifies the JWT → user id, then calls `store_google_token`.

- [ ] **Step 1:** Implement: read `Authorization` bearer, `supabase.auth.getUser()` to resolve uid, validate body, call `rpc('store_google_token', {...})` with service-role client. Return 204 on success, 401 if no/invalid JWT, 400 if body missing `provider_refresh_token`.
- [ ] **Step 2:** Deploy via MCP `deploy_edge_function`.
- [ ] **Step 3:** Test: call with no auth → 401; with fake body shape → 400. (Full happy-path needs a real Google token, deferred to integration.)

---

## Phase 2 — `build-feed` job (per-user fetch → brief → derived-only write)

### Task 2.1: Pure feed-builder module (TDD core)

**Files:**
- Create `supabase/functions/_shared/buildPayload.ts`
- Test `supabase/functions/_shared/buildPayload.test.ts` (Deno test)

**Interfaces — Produces:**
- `buildEvents(rawCalendar): FeedEvent[]`
- `buildEmailTasks(rawGmail): EmailTask[]`
- `templateBrief(events, emailTasks): Brief` (Free tier, deterministic)
- `assemblePayload({profile, brief, events, emailTasks, tz, now}): FeedPayload`

- [ ] **Step 1:** Write failing tests with fixtures: empty calendar → `days[today]=[]`; 2 events → mapped with id/title/start/end; gmail fixtures → capped at 6, promos filtered; `templateBrief` with 3 meetings → stats `[{n:'3',label:'meetings'},...]`; **assert no raw email body string appears anywhere in `assemblePayload` output**.
- [ ] **Step 2:** Run `deno test supabase/functions/_shared/` → FAIL.
- [ ] **Step 3:** Implement the four pure functions.
- [ ] **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit.

### Task 2.2: Google fetch + token refresh module

**Files:** Create `supabase/functions/_shared/google.ts`; Test `google.test.ts`

**Interfaces — Produces:**
- `mintAccessToken(refreshToken): Promise<string>` (POST to `https://oauth2.googleapis.com/token`)
- `fetchTodayEvents(accessToken, tz): Promise<rawCalendar>`
- `fetchActionableUnread(accessToken): Promise<rawGmail>` (query `is:unread in:inbox -category:promotions -category:social -category:updates -category:forums`, cap 6)

- [ ] **Step 1:** Write tests mocking `fetch`: token refresh returns access_token; a 401 from Google throws `TokenRevokedError`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit.

### Task 2.3: Claude brief module (Pro)

**Files:** Create `supabase/functions/_shared/claudeBrief.ts`; Test `claudeBrief.test.ts`

**Interfaces — Produces:** `claudeBrief(events, emailTasks, apiKey): Promise<Brief>` — calls Anthropic Messages API (`claude-haiku-4-5`), returns the same `Brief` shape as `templateBrief`. On API error, throws so caller falls back to `templateBrief`.

- [ ] **Step 1:** Test with mocked Anthropic response → parses into `Brief`; malformed response → throws.
- [ ] **Step 2-5:** FAIL → implement (strict JSON-only system prompt, parse, validate shape) → PASS → commit.

### Task 2.4: `build-feed` orchestrator Edge Function

**Files:** Create `supabase/functions/build-feed/index.ts`

**Interfaces — Consumes:** all `_shared` modules + `get_google_refresh` RPC. **Produces:** endpoint that, for a single `{ user_id }` (or batch when none given), builds and upserts the feed.

- [ ] **Step 1:** Implement per-user flow: load profile+entitlement; `get_google_refresh`; `mintAccessToken`; `fetchTodayEvents`; if `tier='pro'` → `fetchActionableUnread` + `claudeBrief` (fallback `templateBrief` on error); else `templateBrief` with calendar only; `assemblePayload`; `upsert feeds`. On `TokenRevokedError` → set `feeds.needs_reauth=true`, skip. Wrap each user in try/catch so one failure never aborts the batch. **Discard all raw vars after assembly (never stored).**
- [ ] **Step 2:** Deploy via MCP. Set secrets `ANTHROPIC_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (placeholders until user provides — see HANDOFF).
- [ ] **Step 3:** Test: POST with unknown user → graceful skip + logged; malformed → 400.

### Task 2.5: Daily cron

**Files:** migration `0004_cron.sql`

- [ ] **Step 1:** `create extension if not exists pg_cron; create extension if not exists pg_net;`
- [ ] **Step 2:** Schedule (01:00 UTC ≈ 06:30 IST) a job that `net.http_post`s to the `build-feed` function URL with the service-role key, no body (batch mode).
- [ ] **Step 3:** Verify `select jobname, schedule from cron.job;`.

---

## Phase 3 — App rewire (Google sign-in + authenticated feed)

### Task 3.1: Supabase client + auth lib

**Files:** Create `src/lib/supabase.js`; Modify `src/lib/feedConfig.js` (keep anon URL+key as the public client config, drop the shared-row assumption).

**Interfaces — Produces:** `supabase` client; `signInWithGoogle()` (uses `signInWithOAuth` provider google, scopes incl. gmail.readonly, `queryParams:{access_type:'offline',prompt:'consent'}`, redirect to `life.pepl.wrk://auth`); `signOut()`; `getSession()`.

- [ ] **Step 1:** Implement. **Step 2:** `npm run build` green.

### Task 3.2: Capture + store provider refresh token on sign-in

**Files:** Modify `src/lib/supabase.js`; new `src/lib/syncToken.js`

**Interfaces — Produces:** `onAuth()` handler that, when a session has `provider_refresh_token`, POSTs it to the `store-token` function with the user JWT. Idempotent.

- [ ] **Step 1:** Implement + unit test the "has token → posts once" logic with a mocked fetch. **Step 2:** Build green.

### Task 3.3: Authenticated feed provider

**Files:** Modify `src/providers/feed.js`

**Interfaces — Consumes:** `supabase`. **Produces:** `loadFeed()` now reads `from('feeds').select('payload').single()` for the logged-in user (RLS scopes it). Keep offline cache + demo fallback for logged-out/empty.

- [ ] **Step 1:** Adapt; preserve normalize + cache. **Step 2:** SSR render harness + build green. **Step 3:** Commit.

### Task 3.4: Account screen → real auth + Pro status

**Files:** Modify `src/screens/AccountScreen.jsx`

- [ ] **Step 1:** Replace "feed URL/key" UI with: signed-out → "Sign in with Google" (+ "during beta you'll see a 'not verified' screen, tap Advanced → Continue" note); signed-in → name/email, tier badge, "Manage subscription" (Pro), Sign out. **Step 2:** Build + SSR harness green. **Step 3:** Commit.

### Task 3.5: Onboarding + Pro gating in UI

**Files:** Modify `src/WrkApp.jsx`, `src/screens/HomeScreen.jsx`

- [ ] **Step 1:** First-run: if no session → onboarding → Google sign-in. Home: Free tier shows calendar + tasks + templated brief; email-tasks section shows a soft "Pro" upsell card instead of tasks. (Tier comes from `entitlements` read.) **Step 2:** Build + SSR green. **Step 3:** Commit.

---

## Phase 4 — Billing (RevenueCat + entitlement sync)

### Task 4.1: RevenueCat SDK + paywall

**Files:** Add `@revenuecat/purchases-capacitor`; Create `src/lib/billing.js`; Modify AccountScreen/Home upsell to call `purchasePro()`.

**Interfaces — Produces:** `initBilling(userId)`, `isPro()`, `purchasePro()`, `restore()`. (No-op safe on web.)

- [ ] **Step 1:** Implement with the RevenueCat public SDK key from env. **Step 2:** Build green (web no-op). **Step 3:** Commit.

### Task 4.2: RevenueCat webhook → entitlements

**Files:** Create `supabase/functions/rc-webhook/index.ts`; migration `0005_entitlement_upsert.sql` (service-role upsert helper).

**Interfaces — Produces:** endpoint that verifies the RC `Authorization` shared secret, maps `app_user_id`→user, upserts `entitlements.tier`.

- [ ] **Step 1:** Implement + verify-secret check (401 on mismatch). **Step 2:** Deploy. **Step 3:** Test signature reject path.

---

## Phase 5 — Beta ship (mostly HANDOFF; see below)

### Task 5.1: Privacy policy + store assets

**Files:** Create `docs/PRIVACY.md` (read-only access; "we never store your email"; data deletion contact).

- [ ] **Step 1:** Write policy. **Step 2:** Commit.

### Task 5.2: Build the signed beta AAB — **USER STEP** (needs Play Console + keystore).

---

## HANDOFF — steps only the account owner can do

These are wired in code and waiting on credentials:

1. **Google Cloud:** create project → OAuth consent screen (External, Production-unverified) → add scopes `calendar.readonly` + `gmail.readonly` → create OAuth **Web client** (for Supabase) → add ≤100 test users (waitlist emails). Provide **client ID + secret** → set as Supabase Auth Google provider + Edge Function secrets.
2. **Supabase dashboard:** Auth → Providers → Google → paste client ID/secret; set redirect `life.pepl.wrk://auth` and the Supabase callback. (App-side code already done.)
3. **Anthropic:** create API key → set Edge Function secret `ANTHROPIC_API_KEY`.
4. **RevenueCat:** project + Google Play subscription product `wrk_pro` → set public SDK key (app env) + webhook shared secret (Edge Function secret).
5. **Play Console:** $25 account → internal testing track → upload signed AAB → data-safety form → add testers.
6. **Tally:** waitlist form live; export emails → Google test-user allowlist.

---

## Self-Review notes

- Spec coverage: §4 components → Tasks 1.1–4.2; §5 data model → 1.1; §6 daily flow → 2.4/2.5; §7 app changes → 3.1–3.5; §8 testing → tests in 2.1–2.3, 3.2; §9 checklist → Phase 5 + HANDOFF; privacy invariant → asserted in 2.1/2.4.
- Privacy invariant has an explicit test in 2.1 and a discard step in 2.4.
- Token type flow consistent: `provider_refresh_token` → `store-token` → `store_google_token`/Vault → `get_google_refresh` → `mintAccessToken`.
