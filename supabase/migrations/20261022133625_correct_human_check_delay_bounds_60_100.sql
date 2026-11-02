create or replace function public.rtw_create_human_check(p_session_id uuid,p_player_id uuid,p_delay_seconds integer,p_target integer)
returns boolean language plpgsql volatile security definer set search_path = ''
as $function$
declare v_session public.game_sessions%rowtype;
begin
 if auth.role() <> 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 if p_delay_seconds not between 60 and 100 or p_target not between 0 and 3 then raise exception 'invalid check' using errcode='22023'; end if;
 select * into v_session from public.game_sessions where id=p_session_id and user_id=p_player_id and status='active';
 if not found then return false; end if;
 insert into private.rtw_human_checks(session_id,player_id,due_at,target)
 values(p_session_id,p_player_id,v_session.started_at+make_interval(secs=>p_delay_seconds),p_target)
 on conflict do nothing;
 return true;
end
$function$;;
