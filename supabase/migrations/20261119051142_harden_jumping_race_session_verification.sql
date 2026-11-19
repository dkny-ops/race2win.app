-- Additive hardening for new Jumping Race official sessions only. Existing
-- sessions, results, rankings, balances, prizes and payments are untouched.
set lock_timeout = '5s';
set statement_timeout = '30s';

alter table private.jumping_race_sessions
  add column if not exists course_seed bigint check (course_seed between 0 and 4294967295),
  add column if not exists verification_required boolean not null default false,
  add column if not exists verification_nonce uuid,
  add column if not exists verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'failed')),
  add column if not exists verification_verified_at timestamptz;

-- The existing RPC keeps its signature so callers can retry START idempotently.
-- New records receive server-created course and Turnstile binding values.
create or replace function public.jr_start_session(p_player_id uuid, p_request_id uuid)
returns table(id uuid, session_nonce uuid, started_at timestamptz, expires_at timestamptz, plays_remaining integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_hour timestamptz := private.jumping_race_hour_start(now());
  v_session private.jumping_race_sessions%rowtype;
  v_used integer;
  v_seed_bytes bytea := gen_random_bytes(4);
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
    course_seed,verification_required,verification_nonce,verification_status
  ) values(
    p_player_id,p_request_id,'jumping-race-v1',v_hour,now()+interval '12 minutes',
    v_seed,true,gen_random_uuid(),'pending'
  ) returning * into v_session;
  insert into private.jumping_race_audit_events(session_id,player_id,event_type)
    values(v_session.id,p_player_id,'started');
  return query select v_session.id,v_session.session_nonce,v_session.started_at,v_session.expires_at,4-v_used;
end $$;

create or replace function public.jr_session_security_info(p_session_id uuid, p_player_id uuid)
returns table(
  started_at timestamptz,
  expires_at timestamptz,
  status text,
  next_checkpoint integer,
  course_seed bigint,
  verification_required boolean,
  verification_nonce uuid,
  verification_status text
)
language sql stable security definer set search_path = '' as $$
  select s.started_at,s.expires_at,s.status,s.next_checkpoint,s.course_seed,
    s.verification_required,s.verification_nonce,s.verification_status
  from private.jumping_race_sessions s
  where s.id=p_session_id and s.player_id=p_player_id
$$;

create or replace function public.jr_verify_session_human(p_session_id uuid, p_player_id uuid, p_nonce uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_session private.jumping_race_sessions%rowtype;
begin
  if p_session_id is null or p_player_id is null or p_nonce is null then
    raise exception 'Invalid verification.' using errcode='22023';
  end if;
  select * into v_session from private.jumping_race_sessions
    where id=p_session_id and player_id=p_player_id for update;
  if not found or v_session.status <> 'active' or now() >= v_session.expires_at
    or not v_session.verification_required or v_session.verification_status <> 'pending'
    or v_session.verification_nonce is distinct from p_nonce then
    raise exception 'Verification unavailable.' using errcode='P0001';
  end if;
  update private.jumping_race_sessions
    set verification_status='verified', verification_verified_at=clock_timestamp()
    where id=v_session.id;
  return true;
end $$;

create or replace function public.jr_finalize_session(p_session_id uuid, p_player_id uuid, p_score integer, p_elapsed_ms integer, p_action_digest text, p_status text, p_reason text, p_telemetry jsonb)
returns table(result_status text, score integer, duplicate boolean)
language plpgsql security definer set search_path = '' as $$
declare v_session private.jumping_race_sessions%rowtype; v_result private.jumping_race_results%rowtype;
begin
  if p_session_id is null or p_player_id is null or p_score < 0 or p_elapsed_ms < 0
    or p_action_digest !~ '^[0-9a-f]{64}$' or p_status not in ('verified','pending_review','rejected')
    or jsonb_typeof(p_telemetry) <> 'object' then raise exception 'Invalid finalization.' using errcode='22023'; end if;
  select * into v_session from private.jumping_race_sessions where id=p_session_id and player_id=p_player_id for update;
  if not found then raise exception 'Session unavailable.' using errcode='P0002'; end if;
  select * into v_result from private.jumping_race_results where session_id=p_session_id;
  if found then return query select v_result.result_status,v_result.score,true; return; end if;
  if v_session.status <> 'active' or now() >= v_session.expires_at then raise exception 'Session unavailable.' using errcode='P0001'; end if;
  if v_session.verification_required and v_session.verification_status <> 'verified' then
    raise exception 'Human verification required.' using errcode='P0001';
  end if;
  insert into private.jumping_race_results(session_id,player_id,hour_started_at,score,elapsed_ms,action_digest,result_status,rejection_reason,review_reason,telemetry)
    values(p_session_id,p_player_id,v_session.hour_started_at,p_score,p_elapsed_ms,p_action_digest,p_status,
      case when p_status='rejected' then coalesce(p_reason,'server_rejected') else null end,
      case when p_status='pending_review' then coalesce(p_reason,'server_review') else null end,p_telemetry)
    returning * into v_result;
  update private.jumping_race_sessions set status=case when p_status='rejected' then 'rejected' else 'finalized' end, finalized_at=now() where id=p_session_id;
  insert into private.jumping_race_audit_events(session_id,player_id,event_type,detail)
    values(p_session_id,p_player_id,case when p_status='verified' then 'finalized' when p_status='pending_review' then 'review_required' else 'rejected' end,jsonb_build_object('score',p_score));
  return query select v_result.result_status,v_result.score,false;
end $$;

revoke all on function public.jr_session_security_info(uuid,uuid), public.jr_verify_session_human(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.jr_session_security_info(uuid,uuid), public.jr_verify_session_human(uuid,uuid,uuid) to service_role;
revoke all on function public.jr_finalize_session(uuid,uuid,integer,integer,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.jr_finalize_session(uuid,uuid,integer,integer,text,text,text,jsonb) to service_role;
revoke all on function public.jr_start_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.jr_start_session(uuid,uuid) to service_role;

-- The old hourly reader is superseded by the server-only weekly reader. It
-- remains available to audit tooling, but browser roles must not invoke a
-- SECURITY DEFINER function directly.
revoke all on function public.jr_hourly_leaderboard(timestamptz,integer,integer) from public,anon,authenticated;
grant execute on function public.jr_hourly_leaderboard(timestamptz,integer,integer) to service_role;
