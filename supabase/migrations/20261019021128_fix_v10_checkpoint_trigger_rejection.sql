create or replace function private.validate_game_session_checkpoint()
returns trigger language plpgsql set search_path = '' as $$
declare v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions where id = new.game_session_id for update;
  if not found then raise exception 'Official session is unavailable.' using errcode = '23503'; end if;
  if v_session.gameplay_version = 'rtw-v6' then
    if v_session.status <> 'active' or v_session.expires_at <= now() then
      raise exception 'Official session is not active.' using errcode = '23514';
    end if;
    if new.player_id is distinct from v_session.user_id
      or new.gameplay_version is distinct from v_session.gameplay_version
      or new.milestone_score <> new.checkpoint_index * 5000 then
      raise exception 'Checkpoint does not match its official session.' using errcode = '23514';
    end if;
    return new;
  end if;
  if v_session.gameplay_version not in ('rtw-v7','rtw-v8','rtw-v9','rtw-v10')
    or v_session.status <> 'active'
    or v_session.activity_lease_expires_at is null
    or v_session.activity_lease_expires_at <= now()
    or v_session.checkpoint_interval_score <> 1000
    or new.player_id is distinct from v_session.user_id
    or new.gameplay_version is distinct from v_session.gameplay_version
    or new.milestone_score <> new.checkpoint_index * v_session.checkpoint_interval_score then
    raise exception 'Checkpoint does not match its official session.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_game_session_checkpoint() from public, anon, authenticated;;
