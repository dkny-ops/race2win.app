-- Read-only administrator gate. Only the trusted server service role may invoke it.
create or replace function public.rtw_server_is_active_admin(p_actor_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.admin_users a
    where a.user_id = p_actor_user_id and a.is_active
  );
$$;
revoke all on function public.rtw_server_is_active_admin(uuid) from public, anon, authenticated;
grant execute on function public.rtw_server_is_active_admin(uuid) to service_role;
