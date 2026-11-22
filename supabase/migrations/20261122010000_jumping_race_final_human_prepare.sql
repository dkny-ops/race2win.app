-- Add a second, server-bound human-verification gate for new Jumping Race
-- official sessions. It is requested only after Game Over, never during the
-- animation loop. Existing sessions retain their current policy so this
-- additive rollout cannot strand a run already in progress.
set lock_timeout = '5s';
set statement_timeout = '30s';

alter table private.jumping_race_sessions
  add column if not exists final_verification_required boolean not null default false,
  add column if not exists final_verification_nonce uuid,
  add column if not exists final_verification_status text not null default 'pending'
    check (final_verification_status in ('pending', 'verified', 'failed')),
  add column if not exists final_verification_verified_at timestamptz;

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

-- PostgreSQL does not permit changing a table-returning function's OUT
-- signature in place. There are no SQL dependents (checked before rollout),
-- and this migration runs transactionally, so callers see either version.
drop function if exists public.jr_session_security_info(uuid,uuid);
create function public.jr_session_security_info(p_session_id uuid, p_player_id uuid)
returns table(
  started_at timestamptz,
  expires_at timestamptz,
  status text,
  next_checkpoint integer,
  course_seed bigint,
  verification_required boolean,
  verification_nonce uuid,
  verification_status text,
  final_verification_required boolean,
  final_verification_nonce uuid,
  final_verification_status text
)
language sql stable security definer set search_path = '' as $$
  select s.started_at,s.expires_at,s.status,s.next_checkpoint,s.course_seed,
    s.verification_required,s.verification_nonce,s.verification_status,
    s.final_verification_required,s.final_verification_nonce,s.final_verification_status
  from private.jumping_race_sessions s
  where s.id=p_session_id and s.player_id=p_player_id
$$;

create or replace function public.jr_prepare_finalize_human(p_session_id uuid, p_player_id uuid)
returns table(verification_nonce uuid, verification_status text)
language plpgsql security definer set search_path = '' as $$
declare v_session private.jumping_race_sessions%rowtype;
begin
  if p_session_id is null or p_player_id is null then raise exception 'Invalid verification request.' using errcode='22023'; end if;
  select * into v_session from private.jumping_race_sessions
    where id=p_session_id and player_id=p_player_id for update;
  if not found or v_session.status <> 'active' or now() >= v_session.expires_at
    or not v_session.verification_required or v_session.verification_status <> 'verified'
    or not v_session.final_verification_required then
    raise exception 'Final verification unavailable.' using errcode='P0001';
  end if;
  if v_session.final_verification_status = 'pending' and v_session.final_verification_nonce is null then
    update private.jumping_race_sessions
      set final_verification_nonce=gen_random_uuid()
      where id=v_session.id
      returning * into v_session;
  end if;
  if v_session.final_verification_status not in ('pending','verified') then
    raise exception 'Final verification unavailable.' using errcode='P0001';
  end if;
  return query select v_session.final_verification_nonce,v_session.final_verification_status;
end $$;

create or replace function public.jr_verify_finalize_human(p_session_id uuid, p_player_id uuid, p_nonce uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_session private.jumping_race_sessions%rowtype;
begin
  if p_session_id is null or p_player_id is null or p_nonce is null then raise exception 'Invalid verification.' using errcode='22023'; end if;
  select * into v_session from private.jumping_race_sessions
    where id=p_session_id and player_id=p_player_id for update;
  if not found or v_session.status <> 'active' or now() >= v_session.expires_at
    or not v_session.final_verification_required or v_session.final_verification_status <> 'pending'
    or v_session.final_verification_nonce is distinct from p_nonce then
    raise exception 'Final verification unavailable.' using errcode='P0001';
  end if;
  update private.jumping_race_sessions
    set final_verification_status='verified', final_verification_verified_at=clock_timestamp()
    where id=v_session.id;
  return true;
end $$;

revoke all on function public.jr_session_security_info(uuid,uuid), public.jr_prepare_finalize_human(uuid,uuid), public.jr_verify_finalize_human(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.jr_session_security_info(uuid,uuid), public.jr_prepare_finalize_human(uuid,uuid), public.jr_verify_finalize_human(uuid,uuid,uuid) to service_role;
revoke all on function public.jr_start_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.jr_start_session(uuid,uuid) to service_role;
