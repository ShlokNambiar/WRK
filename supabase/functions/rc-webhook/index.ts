// rc-webhook: RevenueCat -> entitlements sync. RevenueCat POSTs subscription
// lifecycle events here; we map the RC app_user_id (which the app sets to the
// Supabase user id) to a Pro/Free tier and upsert it. Auth is a shared secret
// configured in the RevenueCat dashboard and sent as the Authorization header.
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (b: unknown, s: number) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RC_WEBHOOK_SECRET = Deno.env.get("RC_WEBHOOK_SECRET") ?? "";

// Events that grant Pro vs. revoke it. CANCELLATION is NOT a downgrade — access
// continues until EXPIRATION, so we only drop to Free on EXPIRATION.
const GRANT = new Set([
  "INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION",
  "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED", "TRANSFER",
]);
const REVOKE = new Set(["EXPIRATION"]);

// Constant-time secret comparison: a plain !== short-circuits at the first
// differing character, which leaks match-length via response timing. Comparing
// SHA-256 digests makes the loop length fixed regardless of either input.
async function secretMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const va = new Uint8Array(a), vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// Reject replayed events: RevenueCat stamps event_timestamp_ms; anything older
// than 24h is a replay (or hopelessly stale) and must not mutate entitlements.
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  // Shared-secret auth (configured in RevenueCat). Empty secret => reject all.
  const given = req.headers.get("Authorization") ?? "";
  if (!RC_WEBHOOK_SECRET || !(await secretMatches(given, RC_WEBHOOK_SECRET))) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const event = body?.event ?? body;
  const userId: string | undefined = event?.app_user_id;
  const type: string | undefined = event?.type;
  if (!userId || !type) return json({ error: "missing app_user_id/type" }, 400);

  const ts = event?.event_timestamp_ms;
  if (typeof ts === "number" && Date.now() - ts > MAX_EVENT_AGE_MS) {
    return json({ error: "stale event" }, 400);
  }

  let tier: string | null = null;
  if (GRANT.has(type)) tier = "pro";
  else if (REVOKE.has(type)) tier = "free";
  if (!tier) return json({ ok: true, ignored: type }, 200); // not a tier-changing event

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error } = await admin
    .from("entitlements")
    .upsert({ user_id: userId, tier, source: "revenuecat", updated_at: new Date().toISOString() });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, user: userId, tier }, 200);
});
