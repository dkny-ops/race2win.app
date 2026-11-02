-- Flappy only. Activation is separate so existing clients finish before rollout.
set lock_timeout = '5s';
set statement_timeout = '30s';
create table private.flappy_turnstile_control(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into private.flappy_turnstile_control values(true,false);
create table private.flappy_turnstile_checks(
 session_id uuid primary key references private.flappy_sessions(id) on delete restrict,
 player_id uuid not null references auth.users(id) on delete restrict,
 nonce uuid not null default gen_random_uuid(),
 next_due_at timestamptz not null,
 verified_count integer not null default 0 check(verified_count>=0),
 last_verified_at timestamptz
);
alter table private.flappy_turnstile_control enable row level security;
alter table private.flappy_turnstile_checks enable row level security;
revoke all on private.flappy_turnstile_control,private.flappy_turnstile_checks from public,anon,authenticated,service_role;

create function private.flappy_turnstile_start() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='active' and exists(select 1 from private.flappy_turnstile_control where enabled) then
  insert into private.flappy_turnstile_checks(session_id,player_id,next_due_at)
   values(new.id,new.player_id,new.starts_at+(15+floor(random()*21))*interval '1 second');
 end if;
 return new;
end $$;
create trigger flappy_turnstile_start after insert on private.flappy_sessions
 for each row execute function private.flappy_turnstile_start();

create function public.flappy_turnstile_enabled() returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from private.flappy_turnstile_control where enabled)
$$;
create function public.flappy_turnstile_status(p_player uuid,p_session uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare s private.flappy_sessions%rowtype; c private.flappy_turnstile_checks%rowtype; t timestamptz:=clock_timestamp();
begin
 select s0.* into s from private.flappy_sessions s0 join public.games g on g.id=s0.game_id and g.slug='flappy-race'
  where s0.id=p_session and s0.player_id=p_player;
 if not found or s.status<>'active' or t>s.expires_at or t>s.lease_until then raise exception 'Session unavailable'; end if;
 select * into c from private.flappy_turnstile_checks where session_id=s.id and player_id=p_player;
 if not found then return jsonb_build_object('required',false,'serverNow',t); end if;
 return jsonb_build_object('required',true,'serverNow',t,'nextDueAt',c.next_due_at,
  'due',t>=c.next_due_at,'nonce',case when t>=c.next_due_at then c.nonce else null end);
end $$;
create function public.flappy_turnstile_verify(p_player uuid,p_session uuid,p_nonce uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare s private.flappy_sessions%rowtype; c private.flappy_turnstile_checks%rowtype; t timestamptz;
begin
 -- Same lock order as finalization. No browser role can call this RPC.
 select * into s from private.flappy_sessions where id=p_session and player_id=p_player for update;
 t:=clock_timestamp();
 if not found or s.status<>'active' or t>s.expires_at or t>s.lease_until then raise exception 'Session unavailable'; end if;
 select * into c from private.flappy_turnstile_checks where session_id=s.id and player_id=p_player for update;
 if not found or p_nonce is distinct from c.nonce or t<c.next_due_at or t>c.next_due_at+interval '30 seconds'
 then raise exception 'Challenge unavailable'; end if;
 update private.flappy_turnstile_checks set nonce=gen_random_uuid(),last_verified_at=t,
  verified_count=verified_count+1,next_due_at=t+(20+floor(random()*26))*interval '1 second'
  where session_id=s.id;
 return public.flappy_turnstile_status(p_player,p_session);
end $$;
create function private.flappy_turnstile_require() returns trigger language plpgsql security definer set search_path='' as $$
declare c private.flappy_turnstile_checks%rowtype;
begin
 select * into c from private.flappy_turnstile_checks where session_id=new.session_id and player_id=new.player_id for update;
 -- Use the server-replayed collision time: dying before the first check is valid.
 -- Legacy sessions started before activation finish under their original rules.
 if found and new.completed_at>=c.next_due_at then raise exception 'Turnstile verification required'; end if;
 return new;
end $$;
create trigger flappy_turnstile_require before insert on private.flappy_runs
 for each row execute function private.flappy_turnstile_require();

revoke all on function private.flappy_turnstile_start(),private.flappy_turnstile_require(),
 public.flappy_turnstile_enabled(),public.flappy_turnstile_status(uuid,uuid),
 public.flappy_turnstile_verify(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.flappy_turnstile_enabled(),public.flappy_turnstile_status(uuid,uuid),
 public.flappy_turnstile_verify(uuid,uuid,uuid) to service_role;
;
