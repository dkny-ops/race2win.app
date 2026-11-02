create or replace function public.rtw_read_verified_protections(p_session_id uuid,p_player_id uuid)
returns table(resume_simulation_ms integer)
language sql stable security definer set search_path=public,private,pg_temp
as $$
select h.resume_simulation_ms from private.rtw_human_check_history h
join public.game_sessions s on s.id=h.session_id and s.user_id=h.player_id
where h.session_id=p_session_id and h.player_id=p_player_id
and h.verified_at is not null and h.resume_simulation_ms is not null
order by h.resume_simulation_ms
$$;;
