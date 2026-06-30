# WRK feed contract

WRK has **no in-app Google OAuth**. The whole app renders from a single JSON
document — the *feed* — produced out-of-band by a scheduled Claude routine
(Calendar + Gmail + task rollup) and parked anywhere the app can `GET` it.
The app is offline-first: it shows cached data instantly and a clearly-labeled
**demo** payload until a feed URL is configured.

## How the app fetches it

- Configured in **Account → Data feed** (`src/lib/feedConfig.js`,
  `localStorage`): a **Feed URL** and an optional **Access key**.
- The provider (`src/providers/feed.js → getFeed()`) does a plain `GET` on the
  Feed URL. If an access key is set it is sent on **both** headers:

  ```
  apikey: <key>
  Authorization: Bearer <key>
  ```

  (This matches Supabase REST; the key is the anon/service key.)
- **Unwrapping the response.** Supabase REST returns an *array of rows*, so the
  app unwraps it:
  - if the body is an array → take `data[0].payload` (falling back to `data[0]`),
  - else if the body has a `.payload` → use `data.payload`,
  - else use the body as-is.
- The result must have a `.days` map or it is rejected as a bad shape. A good
  payload is cached (`wrk.feed.cache`) for instant/offline open.
- Status surfaced in the UI: **Live** (fresh fetch), **Offline — last saved**
  (fetch failed, served from cache), **Demo data** (no URL configured).

A typical Supabase Feed URL:

```
https://<project>.supabase.co/rest/v1/<table>?select=payload&order=generated_at.desc&limit=1
```

## Feed payload shape

```jsonc
{
  "generatedAt": "ISO 8601",          // when the routine produced this feed
  "profile": {
    "name":      "string",
    "email":     "string",
    "avatarUrl": "string | null"
  },
  "brief": {                          // the "today" morning brief, or null
    "runs":  [ { "text": "string", "emph": true } ],
    "stats": [ { "n": "string|number", "label": "string" } ],
    "text":  "string"
  },
  "days": {                          // keyed by local date "YYYY-MM-DD"
    "2026-06-27": [ /* FeedEvent, … */ ]
  },
  "emailTasks": [
    {
      "id":     "string",
      "title":  "string",
      "source": "Email",
      "meta":   "string",            // e.g. "from Sarah Chen"
      "due":    "string",            // e.g. "10am" | "today" | "Thu"
      "urgent": true,                // optional
      "bucket": "overdue|today|week"
    }
  ]
}
```

## FeedEvent shape

```jsonc
{
  "id":          "string",
  "title":       "string",
  "start":       "ISO 8601",
  "end":         "ISO 8601",
  "location":    "string",          // optional
  "joinUrl":     "string",          // optional (Zoom/Meet link)
  "description": "string",          // optional
  "movedFrom":   "string",          // optional, e.g. "2:00" (rescheduled-from time)
  "attendees": [                     // optional
    {
      "email":          "string",
      "self":           true,        // optional — marks the viewer
      "organizer":      true,        // optional
      "responseStatus": "accepted|needsAction|declined|tentative"
    }
  ]
}
```

`src/providers/feed.js` converts each FeedEvent into the Google-ish shape its
`normalizeEvent` (`src/providers/calendar.js`) expects, so the friendly fields
above (`title`, `start`, `joinUrl`, `movedFrom`, …) are the canonical contract
the routine should emit.
