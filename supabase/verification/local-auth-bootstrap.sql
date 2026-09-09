do $bootstrap$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $bootstrap$;
create schema auth;
create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id), not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

