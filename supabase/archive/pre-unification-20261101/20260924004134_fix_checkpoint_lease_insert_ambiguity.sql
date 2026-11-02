-- `RETURNS TABLE` creates output variables in PL/pgSQL. The historical v7
-- function used an unqualified generate_series alias named checkpoint_index,
-- which collided with that output variable at runtime. Keep every generated
-- index explicitly named so valid server-validated checkpoints can reach the
-- existing atomic insert-and-lease-renewal path.
create or replace function public.rtw_record_game_session_checkpoint_with_lease(
  p_session_id uuid,
  p_player_id uuid,
  p_checkpoint_index integer,
  p_proof_input_digest text,
  p_proof_input_count integer
)
returns table (
  checkpoint_index integer,
  milestone_score integer,
  accepted boolean,
  lease_renewed boolean,
  activity_lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_existing private.game_session_checkpoints%rowtype;
  v_expected_next integer;
  v_now timestamptz := now();
  v_new_lease timestamptz := v_now + interval '6 minutes';
begin
  if p_checkpoint_index not between 1 and 1000000
    or p_proof_input_digest !~ '^[a-f0-9]{64}$'
    or p_proof_input_count not between 0 and 4096 then
    raise exception 'Invalid checkpoint evidence.' using errcode = '22023';
  end if;

  select * into v_session
  from public.game_sessions
  where id = p_session_id and user_id = p_player_id
  for update;
  if not found then
    raise exception 'Official session is unavailable.' using errcode = 'P0002';
  end if;
  if v_session.gameplay_version <> 'rtw-v7'
    or v_session.checkpoint_interval_score <> 1000
    or v_session.activity_lease_expires_at is null then
    raise exception 'Official session does not support renewable leases.' using errcode = '23514';
  end if;
  if v_session.status <> 'active' then
    raise exception 'Official session is not active.' using errcode = '23514';
  end if;
  if v_session.activity_lease_expires_at <= v_now then
    update public.game_sessions
    set status = 'expired', invalidated_at = v_now, invalidation_reason = 'activity_lease_expired'
    where id = v_session.id and status = 'active';
    raise exception 'Official session activity lease has expired.' using errcode = '23514';
  end if;

  select coalesce(max(checkpoint.checkpoint_index), 0) + 1 into v_expected_next
  from private.game_session_checkpoints as checkpoint
  where checkpoint.game_session_id = v_session.id;

  if p_checkpoint_index < v_expected_next then
    select * into v_existing
    from private.game_session_checkpoints as checkpoint
    where checkpoint.game_session_id = v_session.id
      and checkpoint.checkpoint_index = p_checkpoint_index;
    if v_existing.proof_input_digest <> p_proof_input_digest
      or v_existing.proof_input_count <> p_proof_input_count then
      raise exception 'Checkpoint conflicts with canonical evidence.' using errcode = '23514';
    end if;
    return query select v_existing.checkpoint_index, v_existing.milestone_score,
      true, false, v_session.activity_lease_expires_at;
    return;
  end if;

  insert into private.game_session_checkpoints (
    game_session_id, player_id, gameplay_version, checkpoint_index,
    milestone_score, proof_input_digest, proof_input_count
  )
  select v_session.id, v_session.user_id, v_session.gameplay_version, generated.checkpoint_index,
    generated.checkpoint_index * v_session.checkpoint_interval_score, p_proof_input_digest, p_proof_input_count
  from generate_series(v_expected_next, p_checkpoint_index) as generated(checkpoint_index);

  perform set_config('rtw.activity_lease_renewal', 'validated', true);
  update public.game_sessions
  set activity_lease_expires_at = v_new_lease
  where id = v_session.id and status = 'active';

  return query select p_checkpoint_index,
    p_checkpoint_index * v_session.checkpoint_interval_score,
    true, true, v_new_lease;
end;
$$;

revoke all on function public.rtw_record_game_session_checkpoint_with_lease(uuid, uuid, integer, text, integer) from public, anon, authenticated;
grant execute on function public.rtw_record_game_session_checkpoint_with_lease(uuid, uuid, integer, text, integer) to service_role;
