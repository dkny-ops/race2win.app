-- Flappy-style rolling five attempts per sixty minutes, isolated to Jumping Race.
-- Existing sessions and verified results are preserved.
create or replace function public.jr_start_session(p_player_id uuid, p_request_id uuid)
returns table(id uuid, session_nonce uuid, started_at timestamptz, expires_at timestamptz, plays_remaining integer)
language plpgsql security definer set search_path = '' as $$
declare v_hour timestamptz := private.jumping_race_hour_start(now()); v_session private.jumping_race_sessions%rowtype; v_used integer;
begin
 if p_player_id is null or p_request_id is null then raise exception 'Invalid session request.' using errcode='22023'; end if;
 if not (select enabled from private.jumping_race_control where singleton) then raise exception 'Jumping Race competition is disabled.' using errcode='P0001'; end if;
 perform pg_advisory_xact_lock(hashtextextended('jumping-race:rolling:' || p_player_id::text, 0));
 select * into v_session from private.jumping_race_sessions where player_id=p_player_id and start_request_id=p_request_id for update;
 if found then
   select count(*) into v_used from private.jumping_race_sessions where player_id=p_player_id and started_at>now()-interval '1 hour';
   return query select v_session.id,v_session.session_nonce,v_session.started_at,v_session.expires_at,greatest(0,5-v_used); return;
 end if;
 select count(*) into v_used from private.jumping_race_sessions where player_id=p_player_id and started_at>now()-interval '1 hour';
 if v_used >= 5 then raise exception 'Hourly official opportunities exhausted.' using errcode='P0001'; end if;
 if exists(select 1 from private.jumping_race_sessions where player_id=p_player_id and status='active' and expires_at>now()) then
   raise exception 'An official session is already active.' using errcode='P0001';
 end if;
 insert into private.jumping_race_sessions(player_id,start_request_id,gameplay_version,hour_started_at,expires_at)
 values(p_player_id,p_request_id,'jumping-race-v1',v_hour,now()+interval '12 minutes') returning * into v_session;
 insert into private.jumping_race_audit_events(session_id,player_id,event_type) values(v_session.id,p_player_id,'started');
 return query select v_session.id,v_session.session_nonce,v_session.started_at,v_session.expires_at,4-v_used;
end $$;
create or replace function public.jr_read_allowance(p_player_id uuid)
returns table(hour_started_at timestamptz, hour_ends_at timestamptz, plays_remaining integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_used integer; v_next timestamptz;
begin
 if p_player_id is null then raise exception 'Invalid allowance request.' using errcode='22023'; end if;
 select count(*),min(started_at)+interval '1 hour' into v_used,v_next
 from private.jumping_race_sessions where player_id=p_player_id and started_at>now()-interval '1 hour';
 return query select now(),v_next,greatest(0,5-v_used);
end $$;
revoke all on function public.jr_start_session(uuid,uuid),public.jr_read_allowance(uuid) from public,anon,authenticated;
grant execute on function public.jr_start_session(uuid,uuid),public.jr_read_allowance(uuid) to service_role;
