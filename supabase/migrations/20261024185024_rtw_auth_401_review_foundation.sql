create schema if not exists private;
create table if not exists private.rtw_auth_incidents (
 id uuid primary key default gen_random_uuid(),
 occurred_at timestamptz not null default now(),
 route text not null,
 http_status integer not null check (http_status = 401),
 player_id uuid null references auth.users(id) on delete set null,
 reason text not null,
 request_id text not null,
 review_status text not null default 'open' check (review_status in ('open','resolved')),
 constraint rtw_auth_incidents_request_unique unique(request_id)
);
create index if not exists rtw_auth_incidents_player_time_idx on private.rtw_auth_incidents(player_id,occurred_at desc);
create table if not exists private.rtw_game_access_holds (
 player_id uuid primary key references auth.users(id) on delete cascade,
 incident_id uuid not null references private.rtw_auth_incidents(id),
 created_at timestamptz not null default now(),
 lifted_at timestamptz,
 lifted_by uuid references auth.users(id),
 constraint rtw_game_access_holds_lift_check check ((lifted_at is null and lifted_by is null) or (lifted_at is not null and lifted_by is not null))
);
alter table private.rtw_auth_incidents enable row level security;
alter table private.rtw_game_access_holds enable row level security;
revoke all on private.rtw_auth_incidents from anon,authenticated;
revoke all on private.rtw_game_access_holds from anon,authenticated;;
