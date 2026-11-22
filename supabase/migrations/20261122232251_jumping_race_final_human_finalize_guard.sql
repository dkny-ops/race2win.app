-- Run only after the application uses the second final-human-verification
-- route. The lock in jr_finalize_session remains the final concurrency
-- authority; no player-facing role receives EXECUTE on this function.
set lock_timeout = '5s';
set statement_timeout = '30s';

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
  if v_session.final_verification_required and v_session.final_verification_status <> 'verified' then
    raise exception 'Final human verification required.' using errcode='P0001';
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

revoke all on function public.jr_finalize_session(uuid,uuid,integer,integer,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.jr_finalize_session(uuid,uuid,integer,integer,text,text,text,jsonb) to service_role;
