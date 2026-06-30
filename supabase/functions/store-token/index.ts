// store-token: the app POSTs the user's Google provider_refresh_token here
// right after sign-in. We resolve the user from their Supabase JWT, then
// hand the token to the service-role-only store_google_token RPC (Vault).
// The token is never stored anywhere on the client.
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Resolve the user from their JWT.
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: uerr } = await userClient.auth.getUser();
  if (uerr || !user) return json({ error: "invalid authorization" }, 401);

  let body: { provider_refresh_token?: string; scopes?: unknown; tz?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }

  const refresh = body?.provider_refresh_token;
  const scopes = Array.isArray(body?.scopes) ? (body.scopes as string[]) : [];
  if (!refresh || typeof refresh !== "string") {
    return json({ error: "missing provider_refresh_token" }, 400);
  }

  // Service-role client bypasses RLS and can call the locked-down RPC.
  const admin = createClient(url, service);
  const { error } = await admin.rpc("store_google_token", {
    p_user: user.id,
    p_refresh: refresh,
    p_scopes: scopes,
  });
  if (error) return json({ error: error.message }, 500);

  // Capture the device timezone so the daily feed builds the user's real "today"
  // (otherwise non-IST users get a day-key mismatch and a blank calendar).
  const tz = typeof body?.tz === "string" && body.tz ? body.tz : null;
  if (tz) {
    await admin.from("profiles").update({ tz }).eq("id", user.id);
  }

  return new Response(null, { status: 204 });
});
