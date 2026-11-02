-- Finalization and checkpoint evidence must be serialized in one database
-- transaction. A checkpoint cannot appear between the server replay check and
-- the active -> finalized session transition.
create function public.rtw_finalize_game_session_with_checkpoints(
  p_session_id uuid,
  p_player_id uuid,
  p_input_digest text,
  p_input_count integer,
  p_final_score integer,
  p_final_distance_millimeters bigint,
  p_final_elapsed_ms integer,
  p_final_collision_at_ms integer,
  p_checkpoint_proofs jsonb
)
returns table (
  status text,
  input_digest text,
  final_score integer,
  final_distance_millimeters bigint,
  final_elapsed_ms integer,
  final_collision_at_ms integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_checkpoint private.game_session_checkpoints%rowtype;
  v_expected jsonb;
  v_required_count integer;
  v_index integer;
begin
  if p_input_digest !~ '^[a-f0-9]{64}$'
    or p_input_count not between 0 and 4096
    or p_final_score < 0
    or p_final_distance_millimeters < 0
    or p_final_elapsed_ms < 0
    or p_final_collision_at_ms < 0
    or p_final_collision_at_ms > p_final_elapsed_ms
    or p_checkpoint_proofs is null
    or jsonb_typeof(p_checkpoint_proofs) <> 'array' then
    raise exception 'Invalid server finalization evidence.' using errcode = '22023';
  end if;

  select * into v_session
  from public.game_sessions
  where id = p_session_id and user_id = p_player_id
  for update;
  if not found then
    raise exception 'Official session is unavailable.' using errcode = 'P0002';
  end if;
  if v_session.status <> 'active' or v_session.expires_at <= now() then
    raise exception 'Official session is not active.' using errcode = '23514';
  end if;

  v_required_count := floor(p_final_score / 5000.0)::integer;
  for v_checkpoint in
    select * from private.game_session_checkpoints
    where game_session_id = p_session_id
    order by checkpoint_index
  loop
    if v_checkpoint.checkpoint_index > v_required_count then
      raise exception 'Checkpoint exceeds final authoritative score.' using errcode = '23514';
    end if;
    select proof.value into v_expected
    from jsonb_array_elements(p_checkpoint_proofs) as proof(value)
    where (proof.value ->> 'checkpointIndex')::integer = v_checkpoint.checkpoint_index;
    if v_expected is null
      or (v_expected ->> 'inputCount')::integer <> v_checkpoint.proof_input_count
      or (v_expected ->> 'inputDigest') <> v_checkpoint.proof_input_digest then
      raise exception 'Checkpoint conflicts with final replay evidence.' using errcode = '23514';
    end if;
  end loop;

  for v_index in 1..v_required_count loop
    if not exists (
      select 1 from private.game_session_checkpoints
      where game_session_id = p_session_id and checkpoint_index = v_index
    ) then
      insert into private.game_session_checkpoints (
        game_session_id, player_id, gameplay_version, checkpoint_index,
        milestone_score, proof_input_digest, proof_input_count
      ) values (
        p_session_id, p_player_id, v_session.gameplay_version, v_index,
        v_index * 5000, p_input_digest, p_input_count
      );
    end if;
  end loop;

  return query
  update public.game_sessions as session
  set status = 'finalized',
      finalized_at = now(),
      input_digest = p_input_digest,
      input_count = p_input_count,
      final_score = p_final_score,
      final_distance_millimeters = p_final_distance_millimeters,
      final_elapsed_ms = p_final_elapsed_ms,
      final_collision_at_ms = p_final_collision_at_ms
  where session.id = p_session_id
    and session.user_id = p_player_id
    and session.status = 'active'
  returning session.status, session.input_digest, session.final_score,
    session.final_distance_millimeters, session.final_elapsed_ms,
    session.final_collision_at_ms;
end;
$$;

revoke all on function public.rtw_finalize_game_session_with_checkpoints(uuid, uuid, text, integer, integer, bigint, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.rtw_finalize_game_session_with_checkpoints(uuid, uuid, text, integer, integer, bigint, integer, integer, jsonb) to service_role;
