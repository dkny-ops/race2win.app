-- Additive read-only FlappyRace API. Does not change flappy_start or its quota.
create function public.flappy_read_availability(p_player uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_now timestamptz := clock_timestamp(); v_used integer; v_next timestamptz; v_active timestamptz;
begin
  if p_player is null or not exists(select 1 from private.flappy_control where enabled) then
    raise exception 'Availability unavailable';
  end if;
  -- Same strict rolling-window predicate as flappy_start. Count every start,
  -- including finalized/expired sessions; each slot returns independently.
  select count(*), min(created_at) + interval '1 hour' into v_used, v_next
    from private.flappy_sessions where player_id=p_player and created_at>v_now-interval '1 hour';
  select least(expires_at,lease_until) into v_active from private.flappy_sessions
    where player_id=p_player and status='active' and expires_at>=v_now and lease_until>=v_now;
  return jsonb_build_object('limit',5,'remaining',greatest(0,5-v_used),
    'serverNow',v_now,'nextAvailableAt',v_next,'activeUntil',v_active);
end $$;
revoke all on function public.flappy_read_availability(uuid) from public,anon,authenticated;
grant execute on function public.flappy_read_availability(uuid) to service_role;
