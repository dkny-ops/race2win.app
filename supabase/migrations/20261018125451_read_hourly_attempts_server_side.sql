create or replace function public.rtw_read_hourly_opportunities(p_player_id uuid, p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_hour timestamp; v_start timestamptz; v_end timestamptz; v_used integer;
begin
 if p_player_id is null or p_game_id is null then raise exception 'Invalid request'; end if;
 v_hour := date_trunc('hour', timezone('America/New_York', now()));
 v_start := v_hour at time zone 'America/New_York';
 v_end := (v_hour + interval '1 hour') at time zone 'America/New_York';
 select count(*) into v_used from public.game_sessions
 where user_id=p_player_id and game_id=p_game_id
 and created_at >= v_start and created_at < v_end;
 return jsonb_build_object('used',v_used,'reset_at',v_end);
end $$;
revoke all on function public.rtw_read_hourly_opportunities(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rtw_read_hourly_opportunities(uuid,uuid) to service_role;;
