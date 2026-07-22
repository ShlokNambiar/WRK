// delete-account: backs the Play-required in-app account deletion. The
// signed-in user POSTs here with their own JWT; we resolve them via
// admin.auth.getUser (same pattern as build-feed's user path) and erase
// everything server-side with the service-role client: the Google refresh
// token (google_tokens row + its Vault secret, via the service-role-only
// delete_google_token RPC — Vault secrets do NOT cascade from auth.users),
// every app row, and finally the auth user itself. Auth deletion goes LAST so
// a mid-way failure leaves an account that can simply sign in and retry.
//
// Called from a browser/Capacitor webview, so CORS is answered like store-token.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  // CORS preflight — must return 2xx with the CORS headers, no body.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) return json({ error: "unauthorized" }, 401);

  // Resolve the user from their JWT — a user can only ever delete themself.
  const { data: userData, error: uErr } = await admin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (uErr || !userId) return json({ error: "unauthorized" }, 401);

  // 1. Google refresh token: the Vault secret must go explicitly (no cascade).
  const { error: gErr } = await admin.rpc("delete_google_token", { p_user: userId });
  if (gErr) return json({ error: "delete_google_token: " + gErr.message }, 500);

  // 2. App rows. These would cascade with the auth user anyway, but deleting
  // them explicitly makes the wipe complete even if step 3 fails.
  const tables: [string, string][] = [
    ["email_rules", "user_id"],
    ["user_state", "user_id"],
    ["feeds", "user_id"],
    ["entitlements", "user_id"],
    ["profiles", "id"],
  ];
  for (const [table, col] of tables) {
    const { error } = await admin.from(table).delete().eq(col, userId);
    if (error) return json({ error: table + ": " + error.message }, 500);
  }

  // 3. The auth user — LAST, so any failure above never orphans data behind a
  // deleted account.
  const { error: dErr } = await admin.auth.admin.deleteUser(userId);
  if (dErr) return json({ error: "auth delete: " + dErr.message }, 500);

  return json({ ok: true }, 200);
});
