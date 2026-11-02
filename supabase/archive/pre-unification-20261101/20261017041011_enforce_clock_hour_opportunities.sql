-- All official entry points share this guard, including historical RPCs.
-- No rewarded-ad bypass exists until a real provider has a reviewed server verifier.
create index game_sessions_clock_hour_count_idx on public.game_sessions (user_id, game_id, created_at);
create function private.enforce_clock_hour_opportunities()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_hour timestamptz;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('rtw:session-start:' || new.user_id::text, 0));
  v_now := clock_timestamp();
  -- UTC instants distinguish both repeated New York hours at the DST fallback.
  -- New York offsets are whole hours. UTC truncation preserves its clock-hour
  -- boundaries without collapsing the two 01:00 hours when DST ends.
  v_hour := date_trunc('hour', v_now, 'UTC');
  select count(*) into v_count from public.game_sessions as session
  where session.user_id = new.user_id and session.game_id = new.game_id
    and session.created_at >= v_hour and session.created_at < v_hour + interval '1 hour';
  if v_count >= 5 then
    raise exception 'Hourly official opportunities exhausted.' using errcode = 'P0001';
  end if;
  new.created_at := v_now;
  return new;
end;
$$;
revoke all on function private.enforce_clock_hour_opportunities() from public, anon, authenticated;
create trigger game_sessions_clock_hour_opportunities
before insert on public.game_sessions
for each row execute function private.enforce_clock_hour_opportunities();
