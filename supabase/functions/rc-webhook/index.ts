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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  // Shared-secret auth (configured in RevenueCat). Empty secret => reject all.
  if (!RC_WEBHOOK_SECRET || req.headers.get("Authorization") !== RC_WEBHOOK_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const event = body?.event ?? body;
  const userId: string | undefined = event?.app_user_id;
  const type: string | undefined = event?.type;
  if (!userId || !type) return json({ error: "missing app_user_id/type" }, 400);

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
