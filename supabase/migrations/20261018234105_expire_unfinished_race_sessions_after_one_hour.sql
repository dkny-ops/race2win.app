create extension if not exists pg_cron with schema pg_catalog;
create or replace function public.rtw_expire_stale_game_sessions() returns integer language plpgsql security definer set search_path = public, pg_temp as $$ declare changed integer; begin update public.game_sessions set status='expired' where status='active' and created_at <= now() - interval '1 hour'; get diagnostics changed = row_count; return changed; end; $$;
revoke all on function public.rtw_expire_stale_game_sessions() from public, anon, authenticated;
select cron.schedule('rtw-expire-unfinished-sessions-hourly-cap','* * * * *', $$select public.rtw_expire_stale_game_sessions();$$);
select public.rtw_expire_stale_game_sessions();;

