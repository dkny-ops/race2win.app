-- A second human proof is requested only after server replay has stopped the
-- game. It keeps Cloudflare out of the Canvas loop and cannot mutate prior
-- runs, prizes, balances, or payments.
create table if not exists private.flappy_final_checks (
  session_id uuid primary key references private.flappy_sessions(id),
  player_id uuid not null,
  nonce uuid not null unique default extensions.gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  check (expires_at > created_at)
);
alter table private.flappy_final_checks enable row level security;
revoke all on table private.flappy_final_checks from public, anon, authenticated, service_role;

create or replace function public.flappy_create_final_check(p_player uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.flappy_sessions%rowtype; c private.flappy_final_checks%rowtype; v_now timestamptz:=clock_timestamp();
begin
  select * into s from private.flappy_sessions where id=p_session and player_id=p_player for update;
  if not found or s.status<>'finalized' then raise exception 'Session unavailable'; end if;
  if not exists(select 1 from private.flappy_runs where session_id=s.id and eligibility='under_review') then raise exception 'Challenge unavailable'; end if;
  select * into c from private.flappy_final_checks where session_id=s.id for update;
  if found and c.verified_at is not null then raise exception 'Challenge unavailable'; end if;
  if not found then
    insert into private.flappy_final_checks(session_id,player_id,expires_at) values(s.id,p_player,v_now+interval '5 minutes') returning * into c;
  elsif c.expires_at < v_now then
    update private.flappy_final_checks set nonce=extensions.gen_random_uuid(),created_at=v_now,expires_at=v_now+interval '5 minutes' where session_id=s.id returning * into c;
  end if;
  return jsonb_build_object('nonce',c.nonce,'expiresAt',c.expires_at);
end $$;

create or replace function public.flappy_verify_final_check(p_player uuid,p_session uuid,p_nonce uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.flappy_sessions%rowtype; c private.flappy_final_checks%rowtype; r private.flappy_runs%rowtype; p private.flappy_preflight_checks%rowtype; v_now timestamptz:=clock_timestamp(); v_gaps integer[]; v_perfect boolean:=false; v_outcome jsonb;
begin
  select * into s from private.flappy_sessions where id=p_session and player_id=p_player for update;
  if not found or s.status<>'finalized' then raise exception 'Session unavailable'; end if;
  select * into c from private.flappy_final_checks where session_id=s.id and player_id=p_player for update;
  if not found or c.verified_at is not null or c.nonce is distinct from p_nonce or c.expires_at < v_now then raise exception 'Challenge unavailable'; end if;
  select * into r from private.flappy_runs where session_id=s.id for update;
  if not found or r.eligibility<>'under_review' then raise exception 'Challenge unavailable'; end if;
  select * into p from private.flappy_preflight_checks where session_id=s.id and player_id=p_player and verified_at is not null and consumed_at is not null for key share;
  if not found then
    update private.flappy_runs set review_note=coalesce(review_note,'missing_session_bound_preflight') where session_id=s.id;
  else
    select array_agg(input_tick-previous_tick) into v_gaps from (select input_tick,lag(input_tick) over(order by input_index) previous_tick from unnest(s.inputs) with ordinality as input_stream(input_tick,input_index)) gaps where previous_tick is not null;
    if r.score>=15 and cardinality(v_gaps)>=12 and (select count(distinct gap) from unnest(v_gaps) as gap_stream(gap))=1 then v_perfect:=true; end if;
    update private.flappy_runs set eligibility=case when v_perfect then 'under_review' else 'valid' end, verification='replay_verified', review_note=case when v_perfect then coalesce(review_note,'automated_input_pattern') else null end where session_id=s.id returning * into r;
  end if;
  update private.flappy_final_checks set verified_at=v_now where session_id=s.id;
  select * into r from private.flappy_runs where session_id=s.id;
  v_outcome:=jsonb_build_object('score',r.score,'collisionTick',r.collision_tick,'eligibility',r.eligibility,'verification',r.verification);
  update private.flappy_sessions set outcome=v_outcome where id=s.id;
  return v_outcome;
end $$;

create or replace function private.flappy_turnstile_require()
returns trigger language plpgsql security definer set search_path='' as $$
declare p private.flappy_preflight_checks%rowtype;
begin
  select * into p from private.flappy_preflight_checks where session_id=new.session_id and player_id=new.player_id and verified_at is not null and consumed_at is not null for key share;
  new.verification:='replay_verified';
  new.eligibility:='under_review';
  new.review_note:=case when p.nonce is null then coalesce(new.review_note,'missing_session_bound_preflight') else coalesce(new.review_note,'final_human_proof_pending') end;
  return new;
end $$;

revoke all on function public.flappy_create_final_check(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.flappy_verify_final_check(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.flappy_create_final_check(uuid,uuid),public.flappy_verify_final_check(uuid,uuid,uuid) to service_role;
