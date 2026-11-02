create or replace function public.rtw_end_human_check_timeout(p_session_id uuid,p_player_id uuid,p_input_digest text,p_input_count integer,p_score integer,p_distance bigint,p_elapsed integer)
returns table(score integer,distance_millimeters bigint,elapsed_ms integer) language plpgsql security definer set search_path='' as $$
declare v_check private.rtw_human_checks%rowtype; v_session public.game_sessions%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 if p_input_digest !~ '^[a-f0-9]{64}$' or p_input_count not between 0 and 4096 or p_score<0 or p_distance<0 or p_elapsed<0 then raise exception 'invalid evidence' using errcode='22023'; end if;
 select * into v_session from public.game_sessions where id=p_session_id and user_id=p_player_id for update;
 if not found or v_session.status<>'active' then raise exception 'session not active' using errcode='23514'; end if;
 select * into v_check from private.rtw_human_checks where session_id=p_session_id and player_id=p_player_id for update;
 if not found or v_check.status<>'pending' or now()<v_check.due_at+interval '5 seconds' or v_check.chosen_at is not null then raise exception 'not timed out' using errcode='23514'; end if;
 update public.game_sessions set status='invalid',invalidated_at=now(),invalidation_reason='human_check_timeout',input_digest=p_input_digest,input_count=p_input_count,final_score=p_score,final_distance_millimeters=p_distance,final_elapsed_ms=p_elapsed,anti_fraud_status='rejected',referral_eligible=false where id=p_session_id and user_id=p_player_id and status='active';
 update private.rtw_human_checks set status='timed_out' where session_id=p_session_id and player_id=p_player_id;
 return query select p_score,p_distance,p_elapsed;
end $$;
revoke all on function public.rtw_end_human_check_timeout(uuid,uuid,text,integer,integer,bigint,integer) from public,anon,authenticated;
grant execute on function public.rtw_end_human_check_timeout(uuid,uuid,text,integer,integer,bigint,integer) to service_role;;
