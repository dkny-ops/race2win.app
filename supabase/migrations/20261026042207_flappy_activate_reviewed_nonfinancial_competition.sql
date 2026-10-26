-- Activation of non-financial, manually reviewed Flappy competition only.
-- No prizes, payable balances, automatic awards, ad grants or payments.
do $guard$
begin
 if not exists(select 1 from private.admin_users a join auth.users u on u.id=a.user_id where a.is_active and u.email_confirmed_at is not null and lower(u.email)='racetowinapp@gmail.com') then raise exception 'Owner review unavailable'; end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relname like 'flappy_%' and c.relrowsecurity)<>8 then raise exception 'Flappy RLS not verified'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'flappy_%' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'Browser RPC access'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relname like 'flappy_%' and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE'))) then raise exception 'Direct table access'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'flappy_%' and not has_function_privilege('service_role',p.oid,'EXECUTE')) then raise exception 'Service RPC unavailable'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'flappy_%' and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'],false))) then raise exception 'Unsafe function configuration'; end if;
 if to_regprocedure('public.flappy_review_run(uuid,uuid,text,text)') is null or to_regprocedure('public.flappy_close_week(uuid,date)') is null or to_regprocedure('public.flappy_read_week(date)') is null then raise exception 'Review or closure unavailable'; end if;
 if exists(select 1 from private.flappy_runs) or exists(select 1 from private.flappy_sessions) or exists(select 1 from private.flappy_review_events) or exists(select 1 from private.flappy_week_closures) then raise exception 'Unexpected retained data: audit before activation'; end if;
 if not exists(select 1 from public.games where slug='flappy-race' and status='paused') then raise exception 'Paused Flappy catalogue required'; end if;
end $guard$;
update public.games set status='active',updated_at=clock_timestamp() where slug='flappy-race';
update private.flappy_control set enabled=true where singleton=true;
-- Emergency stop is a targeted registered forward migration setting enabled=false;
-- retain sessions/review evidence. The independent reviewed code gate remains.
