create or replace function public.rtw_record_verified_protection(p_session_id uuid,p_player_id uuid,p_nonce uuid,p_resume_ms integer)
returns boolean language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
if auth.role()<>'service_role' or p_resume_ms is null or p_resume_ms<0 or p_resume_ms>3600000 then return false; end if;
update private.rtw_human_check_history h set resume_simulation_ms=p_resume_ms,protection_applied_at=now()
where h.session_id=p_session_id and h.player_id=p_player_id and h.challenge_nonce=p_nonce
and h.verified_at is not null and h.resume_simulation_ms is null
and exists(select 1 from public.game_sessions s where s.id=p_session_id and s.user_id=p_player_id and s.status='active'
and p_resume_ms<=extract(epoch from (h.due_at-s.started_at))*1000+5000);
return found;
end $$;;
