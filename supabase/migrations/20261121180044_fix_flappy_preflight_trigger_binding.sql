-- Correct the preflight column reference in the prior trigger repair. The
-- established table records the bound run in `session_id`; a preflight is
-- valid once it was consumed into that session at START, even when its short
-- widget-expiry time has elapsed during a legitimate flight.
--
-- No historical rows, balances, prizes or permissions are changed.
create or replace function private.flappy_turnstile_require()
returns trigger language plpgsql security definer set search_path='' as $$
declare p private.flappy_preflight_checks%rowtype; v_gaps integer[]; v_perfect boolean:=false;
begin
  select * into p from private.flappy_preflight_checks
  where session_id=new.session_id and player_id=new.player_id
    and verified_at is not null and consumed_at is not null
  for key share;
  if not found then
    new.eligibility:='under_review'; new.verification:='replay_verified';
    new.review_note:=coalesce(new.review_note,'missing_session_bound_preflight');
    return new;
  end if;
  select array_agg(input_tick - previous_tick) into v_gaps from (
    select input_tick, lag(input_tick) over(order by input_index) previous_tick
    from unnest((select inputs from private.flappy_sessions where id=new.session_id))
      with ordinality as input_stream(input_tick,input_index)
  ) gaps where previous_tick is not null;
  if new.score >= 15 and cardinality(v_gaps) >= 12
    and (select count(distinct gap) from unnest(v_gaps) as gap_stream(gap))=1 then v_perfect:=true; end if;
  new.verification := 'replay_verified';
  new.eligibility := case when v_perfect then 'under_review' else 'valid' end;
  if v_perfect then new.review_note := coalesce(new.review_note,'automated_input_pattern'); end if;
  return new;
end $$;

revoke all on function private.flappy_turnstile_require() from public, anon, authenticated, service_role;
