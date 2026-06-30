# WRK — Privacy Policy

_Last updated: 2026-07-01_

WRK is a personal daily-planner app that shows your calendar and the emails that
need a reply on one screen. This policy explains exactly what WRK accesses, what
it stores, and what it never does.

## What WRK accesses

When you sign in with Google, WRK requests **read-only** access to:

- **Google Calendar** (`calendar.readonly`) — to show today's events.
- **Gmail** (`gmail.readonly`, Pro only) — to find the few unread emails that
  look like they need a reply.

WRK **cannot** send email, change your calendar, delete anything, or modify your
Google account in any way. The access is read-only.

## What WRK stores — and what it does not

Once a day, on our server, WRK reads your calendar and (for Pro users) your
unread inbox, and from that builds a small summary: a short brief, your meeting
list, and a list of "emails to reply to" (subject + sender only).

- **We store only that derived summary.** It is the only thing saved to our
  database, and only you can read it (enforced by per-user row-level security).
- **We never store the contents of your emails.** Email bodies are read in
  memory to build the summary and then discarded. They are never written to our
  database and never leave the processing step. For Gmail we request only the
  message **metadata** (subject and sender) — not the body.
- **We never store your raw calendar data** beyond the derived event list shown
  in the app.

## Your Google tokens

To refresh your summary each morning, WRK securely stores the Google refresh
token issued when you sign in. It is kept **encrypted** (Supabase Vault) and is
accessible only to the server process that builds your feed — never to the app,
never to other users, never over our public API.

## Third parties

- **Supabase** — our database and authentication provider (stores your derived
  feed and encrypted token).
- **Anthropic (Claude API)** — for Pro users, the brief's wording is generated
  by Claude. Only event titles/times and email **subjects and senders** are sent
  — never email bodies.
- **Google** — the source of your calendar and email data, under the read-only
  scopes above.
- **RevenueCat / Google Play** — process Pro subscriptions. WRK does not see or
  store your payment details.

We do not sell your data, show ads, or share your data for advertising.

## Deleting your data

You can sign out at any time. To delete your account and all stored data
(derived feed, entitlement, and encrypted token), email **shlok@pepl.life** and
we will remove it.

## Contact

Questions about this policy: **shlok@pepl.life**
