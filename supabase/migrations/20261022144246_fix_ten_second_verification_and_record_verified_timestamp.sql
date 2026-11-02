create or replace function public.rtw_verify_and_advance_human_check(p_session_id uuid,p_player_id uuid,p_nonce uuid,p_choice integer,p_next_target integer)
returns boolean language plpgsql security definer set search_path='public','private','pg_temp' as $$
declare v_check private.rtw_human_checks%rowtype; v_ok boolean;
begin
 if auth.role()<>'service_role' or p_next_target not between 0 and 3 then return false; end if;
 select * into v_check from private.rtw_human_checks where session_id=p_session_id and player_id=p_player_id for update;
 if not found or v_check.status<>'pending' or v_check.nonce<>p_nonce or v_check.target<>p_choice or v_check.due_at>now()
 or v_check.chosen_at is null or v_check.chosen_at<v_check.due_at
 or v_check.chosen_at>=v_check.due_at+interval '10 seconds' then return false; end if;
 select public.rtw_verify_human_check(p_session_id,p_player_id,p_nonce,p_choice) into v_ok;
 if v_ok is distinct from true then return false; end if;
 insert into private.rtw_human_check_history(session_id,challenge_nonce,player_id,due_at,verified_at)
 values(p_session_id,p_nonce,p_player_id,v_check.due_at,now());
 update private.rtw_human_checks set status='pending',verified_at=null,nonce=gen_random_uuid(),target=p_next_target,due_at=v_check.due_at+interval '100 seconds',chosen_at=null
 where session_id=p_session_id and player_id=p_player_id and nonce=p_nonce;
 return found;
end $$;
revoke all on function public.rtw_verify_and_advance_human_check(uuid,uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.rtw_verify_and_advance_human_check(uuid,uuid,uuid,integer,integer) to service_role;;
