-- The REST Data API intentionally does not expose the private schema. This
-- server-only function is the narrow bridge needed by the checkpoint route to
-- verify that new replay evidence preserves immutable, already accepted input
-- prefixes. It validates ownership itself and returns no session, identity, or
-- replay details beyond the four proof fields required for that comparison.
create function public.rtw_read_game_session_checkpoint_proofs(
  p_session_id uuid,
  p_player_id uuid
)
returns table (
  checkpoint_index integer,
  milestone_score integer,
  proof_input_digest text,
  proof_input_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_session_id is null or p_player_id is null then
    raise exception 'Official session is unavailable.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.game_sessions as session
    where session.id = p_session_id
      and session.user_id = p_player_id
  ) then
    raise exception 'Official session is unavailable.' using errcode = 'P0002';
  end if;

  return query
  select checkpoint.checkpoint_index,
         checkpoint.milestone_score,
         checkpoint.proof_input_digest,
         checkpoint.proof_input_count
  from private.game_session_checkpoints as checkpoint
  where checkpoint.game_session_id = p_session_id
  order by checkpoint.checkpoint_index;
end;
$$;

revoke all on function public.rtw_read_game_session_checkpoint_proofs(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rtw_read_game_session_checkpoint_proofs(uuid, uuid) to service_role;
