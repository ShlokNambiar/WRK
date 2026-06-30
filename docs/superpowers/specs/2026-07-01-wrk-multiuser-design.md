# WRK — Multi-User Public App Design

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Author:** Shlok + Claude

---

## 1. Goal

Turn WRK from a single-user, PC-fed feed renderer into a **multi-user public app** where each person signs in with Google and the cloud builds their personalised daily feed.

**Near-term target:** a **closed beta** (≤100 testers from the Reddit waitlist), **Android only**, with full Calendar + Gmail (read-only) functionality. iOS and fully-public launch are explicit later phases.

**One-line product:** "Open the app, see everything that matters about your day on one screen, be on your way."

---

## 2. Scope decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Data access | Google OAuth, **Gmail + Calendar READ-ONLY** | Core value = calendar + email triage; read-only is the trust bar testers asked for. |
| Platform (now) | **Android** via Capacitor | Defers Apple's $99/yr + review; Capacitor flips to iOS later with no rewrite. |
| Backend | **Supabase** (Auth + Postgres + Edge Functions + pg_cron) | Already in use; does auth, storage, and scheduled jobs natively on one platform. |
| Data retention | **Store only the derived feed; discard raw email/calendar content** | Most private design; smallest breach surface; honest "we never store your email" promise. |
| Daily brief | **Claude API** (cheap model) for Pro; **templated** (no AI) for Free | Warm brief is the product's soul for Pro; Free stays $0/user to run. |
| Monetization | **Freemium**: Free = calendar+tasks+templated; Pro = Gmail triage + AI brief + notifications | Paywall lines up with cost AND compliance AND the killer feature. |
| Billing | **RevenueCat** + Google Play subscriptions | Don't hand-roll receipts/entitlements; free under ~$2.5k/mo revenue. |
| Beta entitlement | **Everyone gets Pro free during beta** | We're validating the email feature; monetization switches on at public launch. |

---

## 3. Compliance & OAuth reality (the gating constraints)

- **Gmail `gmail.readonly` is a Google *restricted* scope.** Public availability requires Google's **OAuth verification + CASA security audit** (paid, ~annual). This is the wall that separates "beta" from "public."
- **Calendar `calendar.readonly` is a *sensitive* scope** — lighter brand verification, **no CASA audit**.
- **Beta path (no audit):** Google OAuth consent screen stays unverified; app is limited to **≤100 manually-allowlisted test users**. The waitlist collects the Gmail addresses we add to that allowlist.
- **OAuth token-lifetime quirk (affects beta UX):**
  - Consent screen in **"Testing"** publishing status → **refresh tokens expire after 7 days** (testers would re-auth weekly — bad for a daily app).
  - Consent screen in **"Production" but unverified** → refresh tokens are long-lived, but users see a "Google hasn't verified this app" screen (click *Advanced → continue*) and the 100-user cap still applies.
  - **Decision for beta:** use **Production + unverified** to get long-lived tokens; give testers a one-line "tap Advanced → Continue, that's expected" note during onboarding.
- **Public path (later phase):** complete brand verification (Calendar) + CASA audit (Gmail) to lift the 100-user cap and remove the warning screen.

---

## 4. Architecture

```
┌──────────────────┐  1. Sign in with Google (Gmail+Cal read-only)  ┌────────────────────┐
│   WRK app        │ ───────────────────────────────────────────────▶│  Supabase Auth     │
│  (Android,       │                                                  │  (Google provider) │
│   Capacitor)     │   reads ONLY its own feed (RLS by user_id)       └─────────┬──────────┘
│                  │ ◀───────────────────────────────┐                          │ on sign-in: store
│  - one-screen    │                                 │                          │ provider_refresh_token
│    day view      │                                 │                ┌─────────▼──────────┐
│  - tasks (local) │                                 └────────────────│  Postgres          │
│  - Pro upsell    │                                                  │  profiles          │
│    (RevenueCat)  │                                                  │  google_tokens     │
└──────────────────┘                                                  │  entitlements      │
                                                                      │  feeds (derived)   │
            2. daily, per user (pg_cron schedule)                     └─────────▲──────────┘
        ┌──────────────────────────────────────────┐                           │ write derived
        │  Edge Function: build-feed               │                           │ feed only
        │  for each active user:                   │───────────────────────────┘
        │   a. refresh Google access token         │
        │   b. fetch today's Calendar events       │
        │   c. (Pro) fetch unread inbox            │
        │   d. (Pro) Claude API → warm brief +     │
        │      email triage; (Free) templated brief│
        │   e. UPSERT feeds row; DISCARD raw       │
        └──────────────────────────────────────────┘
```

### Components (each independently testable)

1. **Auth + token store** — Supabase Google OAuth requesting `calendar.readonly` (+ `gmail.readonly` for Pro). On sign-in, capture `provider_refresh_token` and persist it (Supabase does not auto-refresh Google tokens server-side, so we store and refresh ourselves).
2. **`build-feed` Edge Function** — the per-user daily job. Pure function of (user tokens, entitlement) → feed. Mints a fresh Google access token from the stored refresh token, fetches data, calls Claude (Pro) or templates (Free), writes the derived feed, and discards raw content in-memory.
3. **`set-feed` / read path** — app reads `feeds` row for `auth.uid()` via RLS. Same feed JSON contract the current app already renders.
4. **Entitlement sync** — RevenueCat webhook → `entitlements` table (`free` | `pro`). The Edge Function reads this to decide Gmail+AI vs templated.
5. **App shell (existing, lightly changed)** — replace the "paste a feed URL" Account screen with real Google sign-in + Pro status; everything else (day view, tasks, notifications) stays.

---

## 5. Data model (Postgres)

```sql
-- One row per user, mirrors auth.users
profiles(
  id uuid pk references auth.users,
  email text,
  name text,
  created_at timestamptz default now()
)

-- Encrypted Google refresh token per user (server-side only; no anon access)
google_tokens(
  user_id uuid pk references auth.users,
  refresh_token text not null,        -- stored encrypted (pgsodium / vault)
  scopes text[],                      -- e.g. {calendar.readonly, gmail.readonly}
  updated_at timestamptz default now()
)

-- Free vs Pro, synced from RevenueCat
entitlements(
  user_id uuid pk references auth.users,
  tier text not null default 'free',  -- 'free' | 'pro'
  source text,                        -- 'revenuecat' | 'beta_grant'
  updated_at timestamptz default now()
)

-- The ONLY place feed data lives; derived, never raw email/calendar bodies
feeds(
  user_id uuid pk references auth.users,
  payload jsonb not null,             -- {generatedAt, profile, brief, days, emailTasks}
  generated_at timestamptz,
  updated_at timestamptz default now()
)
```

**RLS:**
- `feeds`, `profiles`, `entitlements`: user can `SELECT` only their own row (`auth.uid() = user_id`). No client writes.
- `google_tokens`: **no anon/auth client access at all** — service-role (Edge Function) only.
- All client writes to feed/tokens go through the Edge Function with the service-role key, never the app.

---

## 6. Daily flow (per user)

1. `pg_cron` triggers `build-feed` each morning (staggered to avoid Google rate limits at scale).
2. For each user with a valid refresh token:
   - Mint a short-lived Google access token from the stored refresh token.
   - Fetch today's primary-calendar events (IST/user TZ).
   - If **Pro**: fetch unread, action-needing inbox (`is:unread in:inbox -category:promotions -social -updates -forums`, cap 6).
   - Build the brief:
     - **Pro** → Claude API writes the warm 1–2 sentence brief + selects emails needing replies.
     - **Free** → deterministic template ("3 meetings today, first at 10:00").
   - UPSERT the `feeds` row with the derived payload. **Raw email/calendar content is never written.**
3. App opens → reads its `feeds` row → renders. Capacitor local notification fires for the morning brief (existing mechanism).

**Failure handling:**
- Revoked/expired refresh token → mark user `needs_reauth`, skip, surface a "reconnect Google" prompt in-app. Never crash the batch.
- Google or Claude API error for one user → log, leave previous feed intact, continue to next user. One user's failure never blocks others.
- Idempotent: re-running the job for a day overwrites that day's feed safely.

---

## 7. App changes (existing React/Capacitor app)

- **Account screen:** replace "paste feed URL + key" with **Sign in with Google** (Supabase) + Pro status / "Upgrade" (RevenueCat).
- **Feed provider:** point reads at the user's own Supabase `feeds` row (authenticated) instead of the shared `id='today'` row. Keep offline cache + demo fallback.
- **Pro gating:** Free accounts show calendar + tasks + templated brief; email-triage section shows a soft "Pro" upsell.
- **Onboarding:** first-run flow → Google sign-in → "tap Advanced → Continue (expected during beta)" note → done.
- Unchanged: one-screen day view, day navigation, task CRUD/reorder, local notifications.

---

## 8. Testing strategy

- **Edge Function (`build-feed`):** unit-test the pure transform (calendar/email JSON → feed payload) with fixtures; mock Google + Claude. Assert raw content never appears in output.
- **RLS:** test that user A cannot read user B's feed/tokens; that `google_tokens` is unreachable by any client key.
- **Auth/token refresh:** integration test the refresh-token → access-token mint and the `needs_reauth` path on a revoked token.
- **App:** existing `npm run build` + SSR render harness for runtime errors; manual smoke on a real device for the OAuth round-trip.
- **Entitlement:** test Free (templated, no Gmail call) vs Pro (Gmail + Claude) branches.

---

## 9. Beta rollout & store-readiness checklist

**Backend / Google**
- [ ] Google Cloud project: OAuth consent screen, scopes `calendar.readonly` + `gmail.readonly`, publishing status = Production (unverified), add ≤100 test users from waitlist.
- [ ] Supabase: tables + RLS + `google_tokens` encryption, `build-feed` Edge Function, `pg_cron` schedule, service-role secrets.
- [ ] Anthropic API key in Edge Function secrets.
- [ ] RevenueCat project + Google Play subscription product; webhook → `entitlements`; beta grant = Pro.

**App / Play**
- [ ] Google Play Console account ($25 one-time), internal-testing track.
- [ ] App icon, store listing, screenshots.
- [ ] **Privacy policy** (required; states read-only access + "we don't store your email").
- [ ] Signed AAB; data-safety form.

**Waitlist**
- [ ] Tally form (email + "android?" + "what do you struggle to keep track of?") → feeds the Google test-user allowlist.

---

## 10. Out of scope (YAGNI — explicitly NOT building now)

- iOS build / App Store (later phase, post-beta).
- CASA audit / public launch (only when beta proves demand).
- Email history, search, or any raw-content storage.
- Team/shared features, multiple calendars, non-Google providers.
- Web/desktop client.
- In-app payments beyond the single Pro subscription.

---

## 11. Phases

1. **Phase 1 — Backend foundation:** Supabase schema + RLS + Google OAuth + token store.
2. **Phase 2 — `build-feed` job:** per-user fetch + Claude/templated brief + derived-only write; cron.
3. **Phase 3 — App rewire:** Google sign-in, authenticated feed read, Pro gating, onboarding.
4. **Phase 4 — Billing:** RevenueCat + Play subscription + entitlement sync; beta = Pro grant.
5. **Phase 5 — Beta ship:** Play internal testing, privacy policy, waitlist onboarding of ≤100 testers.
