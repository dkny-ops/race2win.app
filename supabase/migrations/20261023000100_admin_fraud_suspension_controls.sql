-- Prepared only: no player is suspended by this migration.
-- All decisions are tied to an existing confirmed fraud flag and active owner.
create table if not exists public.rtw_player_suspensions (
 player_id uuid primary key references auth.users(id) on delete restrict,
 fraud_flag_id uuid not null references public.fraud_flags(id) on delete restrict,
 decided_by uuid not null references auth.users(id) on delete restrict,
 reason text not null check (length(trim(reason)) between 20 and 1000),
 suspended_at timestamptz not null default now(),
 lifted_at timestamptz,
 lifted_by uuid references auth.users(id) on delete restrict
);
alter table public.rtw_player_suspensions enable row level security;
revoke all on public.rtw_player_suspensions from anon, authenticated;
create or replace function public.rtw_admin_set_fraud_suspension(
 p_actor uuid, p_player uuid, p_flag uuid, p_reason text
) returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$
begin
 if not public.rtw_server_is_active_admin(p_actor) then raise exception 'Not authorized'; end if;
 if p_actor = p_player then raise exception 'Cannot suspend self'; end if;
 if length(trim(coalesce(p_reason,''))) not between 20 and 1000 then raise exception 'Reason required'; end if;
 if not exists(select 1 from public.fraud_flags
   where id=p_flag and player_id=p_player and status='confirmed'
   and severity in ('high','critical')) then
   raise exception 'Confirmed serious fraud evidence required';
 end if;
 insert into public.rtw_player_suspensions(player_id,fraud_flag_id,decided_by,reason)
 values(p_player,p_flag,p_actor,trim(p_reason))
 on conflict(player_id) do update set
 fraud_flag_id=excluded.fraud_flag_id,decided_by=excluded.decided_by,
 reason=excluded.reason,suspended_at=now(),lifted_at=null,lifted_by=null;
 return true;
end $$;
revoke all on function public.rtw_admin_set_fraud_suspension(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.rtw_admin_set_fraud_suspension(uuid,uuid,uuid,text) to service_role;
create or replace function public.rtw_is_player_suspended(p_player uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
 select exists(select 1 from public.rtw_player_suspensions where player_id=p_player and lifted_at is null);
$$;
revoke all on function public.rtw_is_player_suspended(uuid) from public, anon, authenticated;
grant execute on function public.rtw_is_player_suspended(uuid) to service_role;
