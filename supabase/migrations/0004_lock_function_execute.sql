-- CRITICAL hardening: Postgres grants EXECUTE to PUBLIC by default, and the
-- anon/authenticated roles inherit it. Revoking only from anon/authenticated
-- (as 0003 did) is NOT enough — PUBLIC must be revoked. Without this, any
-- caller could invoke get_google_refresh over REST and read decrypted tokens.
revoke execute on function public.store_google_token(uuid,text,text[]) from public, anon, authenticated;
revoke execute on function public.get_google_refresh(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- The edge functions authenticate as service_role, which must keep access.
grant execute on function public.store_google_token(uuid,text,text[]) to service_role;
grant execute on function public.get_google_refresh(uuid) to service_role;
