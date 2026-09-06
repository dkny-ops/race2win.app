-- Official Race To Win sessions are server-owned. The browser has no table
-- privileges: all authority is exercised by verified server code only.
create table public.game_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  game_id text not null check (game_id = 'race-to-win'),
  gameplay_version text not null check (gameplay_version = 'rtw-v4'),
  seed bigint not null check (seed between 0 and 4294967295),
  status text not null default 'active' check (status in ('active', 'finalized', 'invalid', 'expired')),
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  input_digest text check (input_digest is null or input_digest ~ '^[a-f0-9]{64}$'),
  input_count integer check (input_count is null or input_count between 0 and 4096),
  final_score integer check (final_score is null or final_score >= 0),
  final_distance_millimeters bigint check (final_distance_millimeters is null or final_distance_millimeters >= 0),
  final_elapsed_ms integer check (final_elapsed_ms is null or final_elapsed_ms >= 0),
  final_collision_at_ms integer check (final_collision_at_ms is null or final_collision_at_ms >= 0),
  constraint game_sessions_expiry_window check (expires_at > started_at and expires_at <= started_at + interval '10 minutes'),
  constraint game_sessions_finalized_shape check (
    (status = 'finalized') = (finalized_at is not null)
    and (status <> 'finalized' or (
      input_digest is not null and input_count is not null and final_score is not null
      and final_distance_millimeters is not null and final_elapsed_ms is not null
      and final_collision_at_ms is not null
    ))
  )
);

create index game_sessions_owner_active_created_at_idx
  on public.game_sessions (user_id, created_at desc)
  where status = 'active';

alter table public.game_sessions enable row level security;

-- Do not expose sessions or official results through the Data API. RLS remains
-- enabled as defense in depth if a future grant is added accidentally.
revoke all on table public.game_sessions from public, anon, authenticated;

create or replace function private.protect_game_session_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.game_id is distinct from old.game_id
    or new.gameplay_version is distinct from old.gameplay_version
    or new.seed is distinct from old.seed
    or new.created_at is distinct from old.created_at
    or new.started_at is distinct from old.started_at
    or new.expires_at is distinct from old.expires_at then
    raise exception 'Immutable game session fields cannot be changed.' using errcode = '23514';
  end if;

  if old.status <> 'active' then
    raise exception 'A completed or invalid session is immutable.' using errcode = '23514';
  end if;

  if new.status = 'active' then
    raise exception 'An active session cannot be rewritten.' using errcode = '23514';
  end if;

  if new.status = 'finalized' and new.finalized_at is null then
    raise exception 'A finalized session requires a server finalization time.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_game_session_integrity() from public, anon, authenticated;

create trigger game_sessions_protect_integrity
  before update on public.game_sessions
  for each row execute function private.protect_game_session_integrity();
