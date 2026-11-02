create or replace function public.rtw_record_auth_401(p_request_id text,p_route text,p_reason text,p_player_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if length(p_request_id) not between 8 and 128 or length(p_route) not between 1 and 200 or length(p_reason) not between 1 and 120 then raise exception 'invalid incident'; end if;
 insert into private.rtw_auth_incidents(request_id,route,reason,http_status,player_id)
 values(p_request_id,p_route,p_reason,401,p_player_id)
 on conflict(request_id) do update set request_id=excluded.request_id returning id into v_id;
 if p_player_id is not null then
  insert into private.rtw_game_access_holds(player_id,incident_id)
  values(p_player_id,v_id)
  on conflict(player_id) do update set incident_id=excluded.incident_id,created_at=now(),lifted_at=null,lifted_by=null;
 end if;
 return v_id;
end $$;
create or replace function public.rtw_is_game_access_held(p_player_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.rtw_game_access_holds h where h.player_id=p_player_id and h.lifted_at is null);
$$;
create or replace function public.rtw_list_auth_401_reviews(p_actor_user_id uuid)
returns table(incident_id uuid,occurred_at timestamptz,route text,reason text,request_id text,player_id uuid,username text,review_status text,access_held boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.rtw_server_is_active_admin(p_actor_user_id) then raise exception 'not authorized'; end if;
 return query select i.id,i.occurred_at,i.route,i.reason,i.request_id,i.player_id,p.username,i.review_status,
 coalesce(h.lifted_at is null,false) and h.player_id is not null
 from private.rtw_auth_incidents i
 left join public.profiles p on p.user_id=i.player_id
 left join private.rtw_game_access_holds h on h.player_id=i.player_id
 order by i.occurred_at desc limit 200;
end $$;
create or replace function public.rtw_authorize_game_access(p_actor_user_id uuid,p_player_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_changed boolean;
begin
 if not public.rtw_server_is_active_admin(p_actor_user_id) then raise exception 'not authorized'; end if;
 update private.rtw_game_access_holds set lifted_at=now(),lifted_by=p_actor_user_id
 where player_id=p_player_id and lifted_at is null;
 v_changed:=found;
 if v_changed then
  update private.rtw_auth_incidents set review_status='resolved' where player_id=p_player_id and review_status='open';
 end if;
 return v_changed;
end $$;
revoke all on function public.rtw_record_auth_401(text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.rtw_is_game_access_held(uuid) from public,anon,authenticated;
revoke all on function public.rtw_list_auth_401_reviews(uuid) from public,anon,authenticated;
revoke all on function public.rtw_authorize_game_access(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rtw_record_auth_401(text,text,text,uuid) to service_role;
grant execute on function public.rtw_is_game_access_held(uuid) to service_role;
grant execute on function public.rtw_list_auth_401_reviews(uuid) to service_role;
grant execute on function public.rtw_authorize_game_access(uuid,uuid) to service_role;;
