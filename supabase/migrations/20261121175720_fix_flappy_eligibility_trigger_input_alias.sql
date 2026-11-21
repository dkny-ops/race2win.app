-- Correct the anti-bot telemetry query used by the Flappy run eligibility
-- trigger. The previous function referenced an unnamed `unnest` output as
-- `value`; PostgreSQL exposes it as `unnest` unless it is explicitly aliased.
-- That raised SQLSTATE 42703 while inserting an otherwise valid final run,
-- causing the complete finalization transaction to roll back.
--
-- This is forward-only: it changes no historical sessions or runs. It keeps
-- the same preflight binding, conservative review hold, ownership and grants.
create or replace function private.flappy_turnstile_require()
returns trigger language plpgsql security definer set search_path='' as $$
declare p private.flappy_preflight_checks%rowtype; v_gaps integer[]; v_perfect boolean:=false;
begin
  select * into p from private.flappy_preflight_checks
  where consumed_session_id=new.session_id and player_id=new.player_id
    and verified_at is not null and expires_at>=new.completed_at
  for key share;
  if not found then
    -- Legacy sessions were created before a server-bound preflight existed.
    -- They remain review-only; never retroactively change their result.
    new.eligibility:='under_review'; new.verification:='replay_verified';
    new.review_note:=coalesce(new.review_note,'missing_session_bound_preflight');
    return new;
  end if;
  -- A server replay proves the score. This conservative telemetry signal
  -- holds, rather than publishes, unusually machine-perfect high-score input
  -- streams. Explicit aliases keep this query valid on PostgreSQL.
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
