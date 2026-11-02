create table if not exists private.rtw_human_checks (
 session_id uuid primary key references public.game_sessions(id) on delete cascade,
 player_id uuid not null references auth.users(id),
 due_at timestamptz not null,
 target smallint not null check (target between 0 and 3),
 nonce uuid not null default gen_random_uuid(),
 status text not null default 'pending' check(status in ('pending','verified')),
 verified_at timestamptz,
 created_at timestamptz not null default now()
);
revoke all on private.rtw_human_checks from public, anon, authenticated;
create or replace function private.rtw_human_check_finalize_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare v_status text;
begin
 if old.status='active' and new.status='finalized' and new.final_elapsed_ms >= 90000 then
   select status into v_status from private.rtw_human_checks where session_id=new.id and player_id=new.user_id;
   if found and v_status <> 'verified' then
     new.anti_fraud_status := 'under_review';
   end if;
 end if;
 return new;
end $$;
drop trigger if exists rtw_human_check_finalize_guard on public.game_sessions;
create trigger rtw_human_check_finalize_guard before update on public.game_sessions for each row execute function private.rtw_human_check_finalize_guard();
create or replace function public.rtw_create_human_check(p_session_id uuid,p_player_id uuid,p_delay_seconds integer,p_target integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_session public.game_sessions%rowtype;
begin
 if auth.role() <> 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 if p_delay_seconds not between 90 and 150 or p_target not between 0 and 3 then raise exception 'invalid check' using errcode='22023'; end if;
 select * into v_session from public.game_sessions where id=p_session_id and user_id=p_player_id and status='active';
 if not found then return false; end if;
 insert into private.rtw_human_checks(session_id,player_id,due_at,target) values(p_session_id,p_player_id,v_session.started_at+make_interval(secs=>p_delay_seconds),p_target)
 on conflict do nothing;
 return true;
end $$;
revoke all on function public.rtw_create_human_check(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.rtw_create_human_check(uuid,uuid,integer,integer) to service_role;
create or replace function public.rtw_read_human_check(p_session_id uuid,p_player_id uuid)
returns table(due_at timestamptz,nonce uuid,status text,target integer) language sql security definer set search_path='' as $$
 select c.due_at,c.nonce,c.status,case when now() >= c.due_at then c.target::integer else null::integer end
 from private.rtw_human_checks c join public.game_sessions s on s.id=c.session_id
 where c.session_id=p_session_id and c.player_id=p_player_id and s.user_id=p_player_id
 and auth.role()='service_role';
$$;
revoke all on function public.rtw_read_human_check(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rtw_read_human_check(uuid,uuid) to service_role;
create or replace function public.rtw_verify_human_check(p_session_id uuid,p_player_id uuid,p_nonce uuid,p_choice integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_updated integer;
begin
 if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 update private.rtw_human_checks c set status='verified',verified_at=now()
 where c.session_id=p_session_id and c.player_id=p_player_id and c.nonce=p_nonce and c.target=p_choice
 and c.due_at<=now() and c.status='pending'
 and exists(select 1 from public.game_sessions s where s.id=c.session_id and s.user_id=p_player_id and s.status='active');
 get diagnostics v_updated=row_count;
 return v_updated=1;
end $$;
revoke all on function public.rtw_verify_human_check(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.rtw_verify_human_check(uuid,uuid,uuid,integer) to service_role;;

