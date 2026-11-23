-- `private.flappy_runs` deliberately requires review metadata to remain null
-- while a row is under review. Preserve that invariant while keeping every
-- new result held until its post-game proof completes.
create or replace function private.flappy_turnstile_require()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.verification:='replay_verified';
  new.eligibility:='under_review';
  new.review_note:=null;
  return new;
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
    update private.flappy_runs set eligibility='under_review',review_note=null where session_id=s.id;
  else
    select array_agg(input_tick-previous_tick) into v_gaps from (select input_tick,lag(input_tick) over(order by input_index) previous_tick from unnest(s.inputs) with ordinality as input_stream(input_tick,input_index)) gaps where previous_tick is not null;
    if r.score>=15 and cardinality(v_gaps)>=12 and (select count(distinct gap) from unnest(v_gaps) as gap_stream(gap))=1 then v_perfect:=true; end if;
    update private.flappy_runs set eligibility=case when v_perfect then 'under_review' else 'valid' end, verification='replay_verified', review_note=null where session_id=s.id returning * into r;
  end if;
  update private.flappy_final_checks set verified_at=v_now where session_id=s.id;
  select * into r from private.flappy_runs where session_id=s.id;
  v_outcome:=jsonb_build_object('score',r.score,'collisionTick',r.collision_tick,'eligibility',r.eligibility,'verification',r.verification);
  update private.flappy_sessions set outcome=v_outcome where id=s.id;
  return v_outcome;
end $$;
