# Connect your Google account (personal — full access, no verification)

Because WRK is **just for you**, you keep the OAuth app in **"Testing" mode** with
yourself as the only test user. In that mode Google grants **every scope you ask
for — including full Gmail read — with NO verification, NO security assessment,
and NO cost.** The restricted-scope gauntlet only applies to *public* apps. You
never publish the OAuth app, so it never applies to you.

WRK already requests these scopes (`src/lib/googleAuth.js`):
- profile / email / openid  — your name + avatar
- calendar.readonly         — today's schedule + auto-tasks
- gmail.readonly            — inbox → "reply to X" task drafts
- tasks                     — Google Tasks sync

## One-time setup (~5 minutes)

1. **Create a Google Cloud project**
   https://console.cloud.google.com → top bar → "New Project" → name it `WRK`.

2. **Enable the APIs** (APIs & Services → Library): enable
   - Gmail API
   - Google Calendar API
   - Google Tasks API

3. **OAuth consent screen** (APIs & Services → OAuth consent screen)
   - User type: **External** → Create.
   - App name `WRK`, your email for support + developer contact. Save.
   - **Publishing status: leave as "Testing".** ← this is the magic.
   - **Test users → Add users → add your own Gmail address.** (Only added test
     users can sign in — that's just you.)
   - You do NOT need to submit for verification. You'll see an "unverified app"
     screen at sign-in — click **Advanced → Go to WRK (unsafe)**. Safe: it's your app.

4. **Create the OAuth client** (APIs & Services → Credentials → Create credentials
   → OAuth client ID)
   - Application type: **Web application**.
   - **Authorized JavaScript origins**, add:
     - `http://localhost:5174`  (dev)
     - your production web origin later, if you host the web build
   - Create → copy the **Client ID** (looks like `xxxxx.apps.googleusercontent.com`).

5. **Give WRK the client ID** — either:
   - create a file `.env` in `wrk-app/` with:
     ```
     VITE_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
     ```
     then restart `npm run dev`, **or**
   - paste it at runtime from the browser console:
     `localStorage.setItem('wrk.google.client_id','xxxxx.apps.googleusercontent.com')`

6. **Connect in the app**: open WRK → **Account tab → Gmail / Calendar → Connect**.
   Approve the Google consent screen. The app immediately switches from mock data
   to your real calendar, inbox-derived tasks, name, and avatar.

## Token lifetime
The browser flow returns a 1-hour access token (auto-refreshed silently while the
tab/app is open). No refresh token is stored on the device, so after long gaps
you may tap Connect again. That's the safe, secret-less tradeoff for a personal app.

## Android (Capacitor) note
The Google Identity Services popup is built for the browser. In the Capacitor
WebView it may not pop reliably. For the packaged Android app, the robust path is
`@capacitor-community/generic-oauth2` (or `@codetrix-studio/capacitor-google-auth`)
with an **Android OAuth client ID** + your app's SHA-1. The web build (and Chrome
on your phone) works with the setup above as-is. Wire native auth when you package
for daily phone use — happy to do that next.

## Privacy
Everything runs **on your device**, talking straight to Google's APIs. There is no
WRK server, so your email/calendar data never leaves your phone/browser except to
Google itself.
