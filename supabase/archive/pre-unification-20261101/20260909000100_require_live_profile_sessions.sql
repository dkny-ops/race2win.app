-- A signed access token can outlive sign-out. Profile data includes the payout
-- destination, so owner checks must also require the token's live Auth session.
create function private.has_active_profile_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions as session
    where session.id::text = (select auth.jwt() ->> 'session_id')
      and session.user_id = (select auth.uid())
      and (session.not_after is null or session.not_after > now())
  );
$$;

revoke all on function private.has_active_profile_session() from public, anon, authenticated;
-- Required only by the bound RLS expression. The private schema remains unexposed.
grant execute on function private.has_active_profile_session() to authenticated;

create policy "Profiles require an active Auth session"
  on public.profiles as restrictive for all to authenticated
  using ((select private.has_active_profile_session()))
  with check ((select private.has_active_profile_session()));
