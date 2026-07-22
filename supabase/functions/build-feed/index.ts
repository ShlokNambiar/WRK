// build-feed: the per-user feed builder. Triggered by pg_cron hourly with
// { "mode": "hourly" } (builds users whose local hour == their brief_hour), by
// ops with no body (all users) or { "user_id": "..." } (one user), or by a
// signed-in user with their own JWT (rebuild self, rate-limited). For each user
// it mints a Google access token from the stored refresh token, fetches the
// next 7 days of calendar (+ Gmail for Pro), builds the brief (AI for Pro — see
// aiBrief; template for Free), and upserts ONLY the derived feed. Raw
// email/calendar content is never persisted.
//
// Auth: verify_jwt is disabled at the platform level; we accept EITHER the
// service-role key as Bearer (pg_cron / ops — full batch powers) OR a user's
// own Supabase JWT (verified via admin.auth.getUser — that user only).
// Browsers/webviews call the user path, so CORS is answered like store-token.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildEvents, buildEmailTasks, templateBrief, assemblePayload, computeStats, groupEventsByDay, applyMovedFrom, dayKeyInTz, usersDueNow, rateLimitRetryAfter, safeTz, emailTasksAllowed, mapHqTasks, type Brief, type FeedEvent, type EmailTask, type FeedPayload, type HqRow } from "./buildPayload.ts";
import { mintAccessToken, fetchWeekEvents, fetchActionableUnread, TokenRevokedError } from "./google.ts";
import { claudeBrief } from "./claudeBrief.ts";
import { geminiBrief } from "./geminiBrief.ts";
import { partitionCandidates } from "./emailFilter.ts";
import { classifyActionable } from "./actionability.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Pick the AI provider by which key is configured. Anthropic is preferred when
// present (higher quality + doesn't train on data); Gemini is the interim
// option; with neither, this throws and the caller uses the deterministic
// template brief. Adding ANTHROPIC_API_KEY later auto-upgrades with no redeploy.
function aiBrief(events: FeedEvent[], emailTasks: EmailTask[]): Promise<Brief> {
  if (ANTHROPIC_API_KEY) return claudeBrief(events, emailTasks, ANTHROPIC_API_KEY);
  if (GEMINI_API_KEY) return geminiBrief(events, emailTasks, GEMINI_API_KEY);
  return Promise.reject(new Error("no AI provider key configured"));
}

const AI_KEYS = { anthropic: ANTHROPIC_API_KEY || undefined, gemini: GEMINI_API_KEY || undefined };

type UserRow = { user_id: string; tier: string; tz: string; name: string; email: string; brief_hour: number; email_tasks_enabled: boolean };

// The user's per-sender curation lists (mute = never, allow = always).
async function loadEmailRules(userId: string): Promise<{ muteSet: Set<string>; allowSet: Set<string> }> {
  const { data } = await admin.from("email_rules").select("sender, mode").eq("user_id", userId);
  const muteSet = new Set<string>();
  const allowSet = new Set<string>();
  for (const r of (data ?? []) as { sender: string; mode: string }[]) {
    if (r.mode === "mute") muteSet.add(r.sender);
    else if (r.mode === "allow") allowSet.add(r.sender);
  }
  return { muteSet, allowSet };
}

async function loadUsers(userId?: string): Promise<UserRow[]> {
  // google_tokens marks who has connected Google. profiles/entitlements share a
  // parent (auth.users) but have no direct FK to google_tokens, so PostgREST
  // can't embed them — fetch each table and join in JS by user id.
  let tq = admin.from("google_tokens").select("user_id");
  if (userId) tq = tq.eq("user_id", userId);
  const { data: toks, error: tErr } = await tq;
  if (tErr) throw new Error("loadUsers tokens: " + tErr.message);
  const ids = (toks ?? []).map((t: any) => t.user_id);
  if (ids.length === 0) return [];

  const [{ data: profs }, { data: ents }] = await Promise.all([
    admin.from("profiles").select("id, name, email, tz, brief_hour, email_tasks_enabled").in("id", ids),
    admin.from("entitlements").select("user_id, tier").in("user_id", ids),
  ]);
  const pById = new Map((profs ?? []).map((p: any) => [p.id, p]));
  const eById = new Map((ents ?? []).map((e: any) => [e.user_id, e]));
  return ids.map((id: string) => {
    const p: any = pById.get(id) || {};
    return {
      user_id: id,
      tier: (eById.get(id) as any)?.tier ?? "free",
      // safeTz here, the single point where tz leaves the profile row — a
      // garbage stored value would otherwise crash every Intl call downstream
      tz: safeTz(p.tz ?? "Asia/Kolkata"),
      name: p.name ?? "there",
      email: p.email ?? "",
      brief_hour: p.brief_hour ?? 7,
      email_tasks_enabled: p.email_tasks_enabled ?? true,
    };
  });
}

async function buildForUser(u: UserRow, now: Date): Promise<{ ok: boolean; reason?: string }> {
  // 1. refresh token (Vault, service-role only)
  const { data: refresh, error: rErr } = await admin.rpc("get_google_refresh", { p_user: u.user_id });
  if (rErr || !refresh) return { ok: false, reason: "no_refresh_token" };

  try {
    const access = await mintAccessToken(refresh as string, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    const rawCal = await fetchWeekEvents(access, u.tz, now);
    let events = buildEvents(rawCal);

    // Diff against the previous feed so a rescheduled meeting carries a
    // "moved from <old time>" chip. Best-effort — no previous feed, no chips.
    const { data: prevRow } = await admin.from("feeds").select("payload").eq("user_id", u.user_id).maybeSingle();
    events = applyMovedFrom(events, (prevRow?.payload ?? null) as FeedPayload | null, u.tz);

    // The week grouped by local date (all 7 keys always present); the brief and
    // the headline stats describe TODAY only.
    const days = groupEventsByDay(events, now, u.tz);
    const todayEvents = days[dayKeyInTz(now, u.tz)] ?? [];

    // Gmail pipeline — Pro only, and skipped entirely when the user has
    // switched email tasks off (profiles.email_tasks_enabled): no Gmail is
    // ever fetched, emailTasks stays [].
    let emailTasks: ReturnType<typeof buildEmailTasks> = [];
    if (emailTasksAllowed(u)) {
      const rawGmail = await fetchActionableUnread(access);
      // 1. user's mute/allow lists, then obvious-bulk rules, split the rest out
      const { muteSet, allowSet } = await loadEmailRules(u.user_id);
      const { allow, undecided } = partitionCandidates(rawGmail.messages, muteSet, allowSet);
      // 2. AI decides the undecided ones; on any failure keep them (never drop real mail)
      let aiKept = undecided;
      try {
        aiKept = await classifyActionable(undecided, AI_KEYS);
      } catch (_e) {
        aiKept = undecided;
      }
      emailTasks = buildEmailTasks({ messages: [...allow, ...aiKept] });
    }

    // The AI brief is keyed on tier alone — a Pro user with email tasks off
    // still gets it, built from calendar only.
    let brief;
    if (u.tier === "pro") {
      try {
        brief = await aiBrief(todayEvents, emailTasks);
      } catch (_e) {
        brief = templateBrief(todayEvents, emailTasks); // graceful AI fallback
      }
    } else {
      brief = templateBrief(todayEvents, []); // Free: calendar only, no Gmail
    }

    // The AI writes the prose; the headline counts are always the deterministic
    // ones (meetings-by-kind, TODAY only — never the whole week), so a model
    // miscount can never surface wrong numbers.
    brief.stats = computeStats(todayEvents, emailTasks);

    // Claude-managed HQ tasks (HQ mode): open rows only, never fail the build
    // over them — accounts without HQ data get an empty list.
    let hqTasks: ReturnType<typeof mapHqTasks> = [];
    try {
      const { data: hqRows } = await admin.from("hq_tasks")
        .select("id,title,note,why,due_date,remind_at,urgent,status")
        .eq("user_id", u.user_id).eq("status", "open")
        .order("due_date", { ascending: true, nullsFirst: false }).limit(50);
      hqTasks = mapHqTasks((hqRows ?? []) as HqRow[], dayKeyInTz(now, u.tz));
    } catch (_e) { /* hq merge is best-effort */ }

    const payload = assemblePayload({
      profile: { name: u.name, email: u.email, avatarUrl: null },
      brief, days, emailTasks, hqTasks, now,
    });

    const { error: upErr } = await admin.from("feeds").upsert({
      user_id: u.user_id,
      payload,
      generated_at: now.toISOString(),
      needs_reauth: false,
      updated_at: now.toISOString(),
    });
    if (upErr) return { ok: false, reason: "upsert_failed: " + upErr.message };
    return { ok: true };
  } catch (e) {
    if (e instanceof TokenRevokedError) {
      // Update the existing row (preserves any prior payload); if the user has no
      // feed row yet (first build), seed a minimal one so the flag isn't lost.
      const { data: upd } = await admin.from("feeds")
        .update({ needs_reauth: true }).eq("user_id", u.user_id).select("user_id");
      if (!upd || upd.length === 0) {
        await admin.from("feeds").insert({ user_id: u.user_id, payload: {}, needs_reauth: true });
      }
      return { ok: false, reason: "needs_reauth" };
    }
    return { ok: false, reason: "error: " + (e as Error).message };
  }
}

// Run the build loop and shape the response — shared by every auth path.
// Bounded worker pool: up to 4 builds in flight, so one slow user never delays
// the whole batch while Google/the AI provider still see capped pressure.
const BUILD_CONCURRENCY = 4;
async function runBuilds(users: UserRow[], now: Date): Promise<Response> {
  const results: Record<string, { ok: boolean; reason?: string }> = {};
  let next = 0;
  const worker = async () => {
    while (next < users.length) {
      const u = users[next++];
      // One user's failure never aborts the batch.
      try {
        results[u.user_id] = await buildForUser(u, now);
      } catch (e) {
        results[u.user_id] = { ok: false, reason: "uncaught: " + (e as Error).message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BUILD_CONCURRENCY, users.length) }, worker));

  const ok = Object.values(results).filter((r) => r.ok).length;
  return json({ users: users.length, built: ok, results }, 200);
}

Deno.serve(async (req) => {
  // CORS preflight — the user-invoked rebuild comes from a browser/webview.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) return json({ error: "unauthorized" }, 401);

  const now = new Date();

  // Path 1: service-role key (pg_cron / ops) — batch powers.
  if (SERVICE_KEY && token === SERVICE_KEY) {
    let body: { user_id?: string; mode?: string } = {};
    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      try { body = await req.json(); } catch { /* batch mode */ }
    }

    let users: UserRow[];
    try {
      users = await loadUsers(body.user_id);
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
    // hourly cron: only users whose local hour equals their brief_hour.
    if (body.mode === "hourly") users = usersDueNow(users, now);
    return runBuilds(users, now);
  }

  // Path 2: a user's own JWT — rebuild ONLY that user, rate-limited so a
  // pull-to-refresh loop can't hammer Google/the AI providers.
  const { data: userData, error: uErr } = await admin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (uErr || !userId) return json({ error: "unauthorized" }, 401);

  // Rate-limit on last_rebuild_at, stamped BEFORE any outbound work below —
  // stamping only on success would let error paths retry without limit,
  // hammering Google + the AI provider.
  const { data: feedRow } = await admin.from("feeds").select("last_rebuild_at").eq("user_id", userId).maybeSingle();
  const retryAfter = rateLimitRetryAfter(feedRow?.last_rebuild_at ?? null, now);
  if (retryAfter > 0) return json({ error: "rate_limited", retryAfter }, 429);
  if (feedRow) {
    await admin.from("feeds").update({ last_rebuild_at: now.toISOString() }).eq("user_id", userId);
  } else {
    // first build: seed a minimal row carrying the stamp (payload is NOT NULL)
    await admin.from("feeds").insert({ user_id: userId, payload: {}, last_rebuild_at: now.toISOString() });
  }

  let users: UserRow[];
  try {
    users = await loadUsers(userId);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
  return runBuilds(users, now);
});
