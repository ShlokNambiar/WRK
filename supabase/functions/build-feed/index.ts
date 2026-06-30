// build-feed: the daily per-user job. Triggered by pg_cron (batch, no body) or
// with { "user_id": "..." } for a single user. For each user it mints a Google
// access token from the stored refresh token, fetches today's calendar (+ Gmail
// for Pro), builds the brief (Claude for Pro, template for Free), and upserts
// ONLY the derived feed. Raw email/calendar content is never persisted.
//
// Auth: this function is internal. verify_jwt is disabled at the platform level;
// instead we require the caller to present the service-role key as a Bearer
// token (pg_cron does this). No client can reach it.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildEvents, buildEmailTasks, templateBrief, assemblePayload } from "./buildPayload.ts";
import { mintAccessToken, fetchTodayEvents, fetchActionableUnread, TokenRevokedError } from "./google.ts";
import { claudeBrief } from "./claudeBrief.ts";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

type UserRow = { user_id: string; tier: string; tz: string; name: string; email: string };

async function loadUsers(userId?: string): Promise<UserRow[]> {
  // google_tokens marks who has connected Google. Join profile + entitlement.
  let q = admin
    .from("google_tokens")
    .select("user_id, profiles(name, email, tz), entitlements(tier)");
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) throw new Error("loadUsers: " + error.message);
  return (data ?? []).map((r: any) => ({
    user_id: r.user_id,
    tier: r.entitlements?.tier ?? "free",
    tz: r.profiles?.tz ?? "Asia/Kolkata",
    name: r.profiles?.name ?? "there",
    email: r.profiles?.email ?? "",
  }));
}

async function buildForUser(u: UserRow, now: Date): Promise<{ ok: boolean; reason?: string }> {
  // 1. refresh token (Vault, service-role only)
  const { data: refresh, error: rErr } = await admin.rpc("get_google_refresh", { p_user: u.user_id });
  if (rErr || !refresh) return { ok: false, reason: "no_refresh_token" };

  try {
    const access = await mintAccessToken(refresh as string, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    const rawCal = await fetchTodayEvents(access, u.tz, now);
    const events = buildEvents(rawCal);

    let emailTasks: ReturnType<typeof buildEmailTasks> = [];
    let brief;
    if (u.tier === "pro") {
      const rawGmail = await fetchActionableUnread(access);
      emailTasks = buildEmailTasks(rawGmail);
      try {
        brief = await claudeBrief(events, emailTasks, ANTHROPIC_API_KEY);
      } catch (_e) {
        brief = templateBrief(events, emailTasks); // graceful AI fallback
      }
    } else {
      brief = templateBrief(events, []); // Free: calendar only, no Gmail
    }

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: u.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const payload = assemblePayload({
      profile: { name: u.name, email: u.email, avatarUrl: null },
      brief, events, emailTasks, today, now,
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
      await admin.from("feeds").update({ needs_reauth: true }).eq("user_id", u.user_id);
      return { ok: false, reason: "needs_reauth" };
    }
    return { ok: false, reason: "error: " + (e as Error).message };
  }
}

Deno.serve(async (req) => {
  // Internal-only: require the service-role key as Bearer.
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${SERVICE_KEY}`) return json({ error: "unauthorized" }, 401);

  let body: { user_id?: string } = {};
  if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
    try { body = await req.json(); } catch { /* batch mode */ }
  }

  const now = new Date();
  let users: UserRow[];
  try {
    users = await loadUsers(body.user_id);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  const results: Record<string, { ok: boolean; reason?: string }> = {};
  for (const u of users) {
    // One user's failure never aborts the batch.
    try {
      results[u.user_id] = await buildForUser(u, now);
    } catch (e) {
      results[u.user_id] = { ok: false, reason: "uncaught: " + (e as Error).message };
    }
  }

  const ok = Object.values(results).filter((r) => r.ok).length;
  return json({ users: users.length, built: ok, results }, 200);
});
