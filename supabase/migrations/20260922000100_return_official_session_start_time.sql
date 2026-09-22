-- Forward-only protocol addition. The client needs the server-established
-- start timestamp to render the same deterministic timeline that the replay
-- validates. The three-second server-side lead-in is the game countdown, so
-- no invisible simulation time is added before the player can control it.
-- The original function remains available for already-deployed
-- callers; the API switches only after this migration is installed.

create function public.rtw_start_official_game_session_v2(
  p_player_id uuid,
  p_game_slug text,
  p_gameplay_version text,
  p_seed bigint
)
returns table (
  id uuid,
  gameplay_version text,
  seed bigint,
  started_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_now timestamptz := now();
  v_started_at timestamptz := v_now + interval '3 seconds';
  v_starts_in_last_minute integer;
begin
  select game.id into v_game_id
  from public.games as game
  where game.slug = p_game_slug and game.status = 'active'
  for key share;
  if not found then raise exception 'Game is unavailable.' using errcode = '22023'; end if;

  -- The single per-player transaction lock makes the count-and-insert rate
  -- limit safe across all server instances. It is one deterministic lock per
  -- invocation, so this function does not take a second player lock and
  -- cannot form a lock-order deadlock.
  perform pg_advisory_xact_lock(hashtextextended('rtw:session-start:' || p_player_id::text, 0));
  select count(*) into v_starts_in_last_minute
  from public.game_sessions as session
  where session.user_id = p_player_id
    and session.created_at >= v_now - interval '1 minute';
  if v_starts_in_last_minute >= 8 then
    raise exception 'Official session start rate limit exceeded.' using errcode = 'P0001';
  end if;

  return query
  insert into public.game_sessions as session (
    id, user_id, game_id, gameplay_version, seed, started_at, expires_at
  )
  values (
    gen_random_uuid(), p_player_id, v_game_id, p_gameplay_version, p_seed,
    v_started_at, v_started_at + interval '10 minutes'
  )
  returning session.id, session.gameplay_version, session.seed, session.started_at, session.expires_at;
end;
$$;

revoke all on function public.rtw_start_official_game_session_v2(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.rtw_start_official_game_session_v2(uuid, text, text, bigint) to service_role;
