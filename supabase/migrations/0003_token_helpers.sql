-- Vault-backed Google refresh-token storage. Service-role only.
create or replace function public.store_google_token(p_user uuid, p_refresh text, p_scopes text[])
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select refresh_token_secret_id into v_id from public.google_tokens where user_id = p_user;
  if v_id is null then
    v_id := vault.create_secret(p_refresh, 'google_refresh_' || p_user::text);
    insert into public.google_tokens(user_id, refresh_token_secret_id, scopes)
      values (p_user, v_id, p_scopes);
  else
    perform vault.update_secret(v_id, p_refresh);
    update public.google_tokens set scopes = p_scopes, updated_at = now() where user_id = p_user;
  end if;
end; $$;

create or replace function public.get_google_refresh(p_user uuid)
returns text language plpgsql security definer set search_path = public, vault as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where id = (select refresh_token_secret_id from public.google_tokens where user_id = p_user);
  return v_secret;
end; $$;

revoke all on function public.store_google_token(uuid,text,text[]) from anon, authenticated;
revoke all on function public.get_google_refresh(uuid) from anon, authenticated;
