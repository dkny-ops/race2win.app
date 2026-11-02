-- Server-validated progress evidence for official game sessions. Checkpoints
-- are not scores, prizes, or competition credits: only finalization can
-- materialize a validated run.

create table private.game_session_checkpoints (
  game_session_id uuid not null references public.game_sessions(id) on delete restrict,
  player_id uuid not null references auth.users(id) on delete restrict,
  gameplay_version text not null,
  checkpoint_index integer not null check (checkpoint_index > 0),
  milestone_score integer not null check (
    milestone_score > 0
    and milestone_score = checkpoint_index * 5000
  ),
  proof_input_digest text not null check (proof_input_digest ~ '^[a-f0-9]{64}$'),
  proof_input_count integer not null check (proof_input_count between 0 and 4096),
  accepted_at timestamptz not null default now(),
  primary key (game_session_id, checkpoint_index),
  unique (game_session_id, milestone_score)
);

create index game_session_checkpoints_player_accepted_idx
  on private.game_session_checkpoints (player_id, accepted_at desc);

alter table private.competition_action_rate_limits
  drop constraint competition_action_rate_limits_action_check;
alter table private.competition_action_rate_limits
  add constraint competition_action_rate_limits_action_check
  check (action in ('referral_attach', 'prize_claim', 'balance_claim', 'game_checkpoint'));

create or replace function public.rtw_consume_competition_action_rate_limit(
  p_player_id uuid,
  p_action text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  case p_action
    when 'referral_attach' then v_limit := 6;
    when 'prize_claim' then v_limit := 6;
    when 'balance_claim' then v_limit := 4;
    -- A real run reaches this at most once per 5,000 authoritative points.
    -- The limit absorbs retries/spam without affecting normal milestone flow.
    when 'game_checkpoint' then v_limit := 18;
    else raise exception 'Unsupported competition action.' using errcode = '22023';
  end case;

  insert into private.competition_action_rate_limits as rate_limit (
    player_id, action, window_started_at, request_count, updated_at
  )
  values (p_player_id, p_action, v_window, 1, now())
  on conflict (player_id, action) do update
    set window_started_at = case
          when rate_limit.window_started_at = v_window then rate_limit.window_started_at
          else v_window
        end,
        request_count = case
          when rate_limit.window_started_at = v_window then rate_limit.request_count + 1
          else 1
        end,
        updated_at = now()
  returning request_count into v_count;

  return v_count <= v_limit;
end;
$$;

revoke all on function public.rtw_consume_competition_action_rate_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.rtw_consume_competition_action_rate_limit(uuid, text) to service_role;

alter table private.game_session_checkpoints enable row level security;
revoke all on table private.game_session_checkpoints from public, anon, authenticated;
grant select, insert on table private.game_session_checkpoints to service_role;

-- This trigger serializes checkpoint insertion with session finalization by
-- taking a row lock on the authoritative session. It derives ownership and
-- rules version from that session, so a server bug or a future broad grant
-- cannot attach a checkpoint to a different player or version. Browser roles
-- have no table or schema privilege and cannot invoke this path directly.
create function private.validate_game_session_checkpoint()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  select * into v_session
  from public.game_sessions
  where id = new.game_session_id
  for update;

  if not found then
    raise exception 'Official session is unavailable.' using errcode = '23503';
  end if;

  if v_session.status <> 'active' or v_session.expires_at <= now() then
    raise exception 'Official session is not active.' using errcode = '23514';
  end if;

  if new.player_id is distinct from v_session.user_id
    or new.gameplay_version is distinct from v_session.gameplay_version then
    raise exception 'Checkpoint does not match its official session.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_game_session_checkpoint() from public, anon, authenticated;

create trigger game_session_checkpoints_validate
  before insert on private.game_session_checkpoints
  for each row execute function private.validate_game_session_checkpoint();

-- Bound checkpoint storage to the short authoritative-session lifetime. This
-- function is server-only; scheduled retention, if configured later, can
-- remove only settled session evidence after the product retention window.
create function private.prune_expired_game_session_checkpoints(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_before > now() - interval '1 day' then
    raise exception 'Checkpoint retention cutoff is too recent.' using errcode = '22023';
  end if;

  delete from private.game_session_checkpoints as checkpoint
  using public.game_sessions as session
  where checkpoint.game_session_id = session.id
    and session.status in ('expired', 'invalid')
    and checkpoint.accepted_at < p_before;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function private.prune_expired_game_session_checkpoints(timestamptz) from public, anon, authenticated, service_role;
