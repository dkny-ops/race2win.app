-- Keep the hardened empty search_path on the official session creator while
-- qualifying pgcrypto's random-byte function in Supabase's extensions schema.
-- This changes no existing session, score, ranking, balance, prize, or payout.
create or replace function public.jr_start_session(p_player_id uuid, p_request_id uuid)
returns table(id uuid, session_nonce uuid, started_at timestamptz, expires_at timestamptz, plays_remaining integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_hour timestamptz := private.jumping_race_hour_start(now());
  v_session private.jumping_race_sessions%rowtype;
  v_used integer;
  v_seed_bytes bytea := extensions.gen_random_bytes(4);
  v_seed bigint := (get_byte(v_seed_bytes, 0)::bigint << 24)
    + (get_byte(v_seed_bytes, 1)::bigint << 16)
    + (get_byte(v_seed_bytes, 2)::bigint << 8)
    + get_byte(v_seed_bytes, 3)::bigint;
begin
  if p_player_id is null or p_request_id is null then raise exception 'Invalid session request.' using errcode='22023'; end if;
  if not (select enabled from private.jumping_race_control where singleton) then raise exception 'Jumping Race competition is disabled.' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('jumping-race:rolling:' || p_player_id::text, 0));
  select * into v_session from private.jumping_race_sessions s where s.player_id=p_player_id and s.start_request_id=p_request_id for update;
  if found then
    select count(*) into v_used from private.jumping_race_sessions s where s.player_id=p_player_id and s.started_at>now()-interval '1 hour';
    return query select v_session.id,v_session.session_nonce,v_session.started_at,v_session.expires_at,greatest(0,5-v_used); return;
  end if;
  select count(*) into v_used from private.jumping_race_sessions s where s.player_id=p_player_id and s.started_at>now()-interval '1 hour';
  if v_used >= 5 then raise exception 'Hourly official opportunities exhausted.' using errcode='P0001'; end if;
  if exists(select 1 from private.jumping_race_sessions s where s.player_id=p_player_id and s.status='active' and s.expires_at>now()) then
    raise exception 'An official session is already active.' using errcode='P0001';
  end if;
  insert into private.jumping_race_sessions(
    player_id,start_request_id,gameplay_version,hour_started_at,expires_at,
    course_seed,verification_required,verification_nonce,verification_status,
    final_verification_required,final_verification_status
  ) values(
    p_player_id,p_request_id,'jumping-race-v1',v_hour,now()+interval '12 minutes',
    v_seed,true,gen_random_uuid(),'pending',true,'pending'
  ) returning * into v_session;
  insert into private.jumping_race_audit_events(session_id,player_id,event_type)
    values(v_session.id,p_player_id,'started');
  return query select v_session.id,v_session.session_nonce,v_session.started_at,v_session.expires_at,4-v_used;
end $$;

revoke all on function public.jr_start_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.jr_start_session(uuid,uuid) to service_role;
