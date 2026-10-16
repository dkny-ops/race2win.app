-- Forward-only, server-authoritative play allowance.  The period is an
-- absolute hour boundary, which is also a New York clock-hour boundary. This
-- deliberately handles the repeated 01:00 at DST fall-back as two distinct
-- real hours rather than accidentally merging sixty extra minutes.
create table private.official_play_allowance_windows (
  player_id uuid not null references auth.users(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  hour_started_at timestamptz not null,
  free_plays_consumed integer not null default 0 check (free_plays_consumed between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, game_id, hour_started_at)
);

-- This is deliberately only a ledger of already provider-verified rewards.
-- There is no browser-facing grant RPC and no simulated "ad watched" path.
create table private.verified_rewarded_play_credits (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  hour_started_at timestamptz not null,
  provider_event_id text not null unique check (char_length(provider_event_id) between 16 and 256),
  provider_name text not null check (char_length(provider_name) between 1 and 64),
  status text not null default 'issued' check (status in ('issued','consumed','expired')),
  issued_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_session_id uuid unique references public.game_sessions(id) on delete restrict,
  check ((status = 'consumed') = (consumed_at is not null and consumed_session_id is not null))
);
create index verified_rewarded_play_credits_available_idx
  on private.verified_rewarded_play_credits (player_id, game_id, hour_started_at, issued_at)
  where status = 'issued';

-- A browser may supply an opaque retry key, but it never chooses the player,
-- game, period, allowance, or result. It only makes a lost start response
-- safely recoverable without double-consuming a play.
create table private.official_play_start_requests (
  player_id uuid not null references auth.users(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  hour_started_at timestamptz not null,
  request_id uuid not null,
  game_session_id uuid unique references public.game_sessions(id) on delete restrict,
  allowance_source text check (allowance_source in ('free','rewarded')),
  created_at timestamptz not null default now(),
  primary key (player_id, game_id, request_id),
  check ((game_session_id is null) = (allowance_source is null))
);

alter table private.official_play_allowance_windows enable row level security;
alter table private.verified_rewarded_play_credits enable row level security;
alter table private.official_play_start_requests enable row level security;
revoke all on table private.official_play_allowance_windows, private.verified_rewarded_play_credits, private.official_play_start_requests from public, anon, authenticated;
grant select, insert, update on table private.official_play_allowance_windows, private.verified_rewarded_play_credits, private.official_play_start_requests to service_role;

create function private.official_play_hour_start(p_at timestamptz default now())
returns timestamptz language sql stable set search_path = '' as $$
  select date_trunc('hour', p_at)
$$;

create function public.rtw_read_official_play_allowance(p_player_id uuid, p_game_slug text)
returns table (hour_started_at timestamptz, hour_ends_at timestamptz, free_plays_remaining integer, rewarded_plays_remaining integer, rewarded_ads_available boolean)
language plpgsql security definer set search_path = '' as $$
declare v_game_id uuid; v_hour timestamptz := private.official_play_hour_start(now()); v_used integer := 0; v_rewarded integer := 0;
begin
  if p_player_id is null or p_game_slug <> 'race-to-win' then raise exception 'Invalid play allowance request.' using errcode = '22023'; end if;
  select game.id into v_game_id from public.games as game where game.slug = p_game_slug and game.status = 'active';
  if not found then raise exception 'Game is unavailable.' using errcode = '22023'; end if;
  select allowance.free_plays_consumed into v_used from private.official_play_allowance_windows as allowance
    where allowance.player_id = p_player_id and allowance.game_id = v_game_id and allowance.hour_started_at = v_hour;
  select count(*) into v_rewarded from private.verified_rewarded_play_credits as credit
    where credit.player_id = p_player_id and credit.game_id = v_game_id and credit.hour_started_at = v_hour and credit.status = 'issued';
  return query select v_hour, v_hour + interval '1 hour', greatest(0, 5 - coalesce(v_used, 0)), v_rewarded, false;
end;
$$;

create function public.rtw_start_official_game_session_v4(
  p_player_id uuid, p_game_slug text, p_gameplay_version text, p_seed bigint, p_start_request_id uuid
)
returns table (
  id uuid, gameplay_version text, seed bigint, started_at timestamptz, expires_at timestamptz,
  checkpoint_interval_score integer, activity_lease_expires_at timestamptz,
  allowance_source text, free_plays_remaining integer, rewarded_plays_remaining integer,
  hour_started_at timestamptz, hour_ends_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_game_id uuid; v_hour timestamptz := private.official_play_hour_start(now());
  v_request private.official_play_start_requests%rowtype; v_credit private.verified_rewarded_play_credits%rowtype;
  v_session record; v_used integer; v_source text; v_free_remaining integer; v_rewarded_remaining integer; v_existing_hour timestamptz;
begin
  if p_player_id is null or p_start_request_id is null or p_gameplay_version <> 'rtw-v7' then
    raise exception 'Invalid official session start.' using errcode = '22023';
  end if;
  select game.id into v_game_id from public.games as game where game.slug = p_game_slug and game.status = 'active' for key share;
  if not found then raise exception 'Game is unavailable.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rtw:play-allowance:' || p_player_id::text || ':' || v_game_id::text || ':' || v_hour::text, 0));

  select request.* into v_request from private.official_play_start_requests as request
    where request.player_id = p_player_id and request.game_id = v_game_id and request.request_id = p_start_request_id for update;
  if found and v_request.game_session_id is not null then
    select session.id, session.gameplay_version, session.seed, session.started_at, session.expires_at, session.checkpoint_interval_score, session.activity_lease_expires_at
      into v_session from public.game_sessions session where session.id = v_request.game_session_id and session.user_id = p_player_id;
    if not found then raise exception 'Official session is unavailable.' using errcode = 'P0002'; end if;
    v_existing_hour := v_request.hour_started_at;
    select allowance.free_plays_consumed into v_used from private.official_play_allowance_windows as allowance where allowance.player_id=p_player_id and allowance.game_id=v_game_id and allowance.hour_started_at=v_existing_hour;
    select count(*) into v_rewarded_remaining from private.verified_rewarded_play_credits as credit where credit.player_id=p_player_id and credit.game_id=v_game_id and credit.hour_started_at=v_existing_hour and credit.status='issued';
    return query select v_session.id,v_session.gameplay_version,v_session.seed,v_session.started_at,v_session.expires_at,v_session.checkpoint_interval_score,v_session.activity_lease_expires_at,v_request.allowance_source,greatest(0,5-coalesce(v_used,0)),v_rewarded_remaining,v_existing_hour,v_existing_hour+interval '1 hour';
    return;
  end if;

  insert into private.official_play_start_requests(player_id,game_id,hour_started_at,request_id)
    values(p_player_id,v_game_id,v_hour,p_start_request_id) on conflict do nothing;
  insert into private.official_play_allowance_windows(player_id,game_id,hour_started_at)
    values(p_player_id,v_game_id,v_hour) on conflict do nothing;
  select allowance.free_plays_consumed into v_used from private.official_play_allowance_windows as allowance
    where allowance.player_id=p_player_id and allowance.game_id=v_game_id and allowance.hour_started_at=v_hour for update;
  if v_used < 5 then
    update private.official_play_allowance_windows set free_plays_consumed=free_plays_consumed+1,updated_at=now()
      where official_play_allowance_windows.player_id=p_player_id and official_play_allowance_windows.game_id=v_game_id and official_play_allowance_windows.hour_started_at=v_hour returning free_plays_consumed into v_used;
    v_source := 'free';
  else
    select * into v_credit from private.verified_rewarded_play_credits
      where verified_rewarded_play_credits.player_id=p_player_id and verified_rewarded_play_credits.game_id=v_game_id and verified_rewarded_play_credits.hour_started_at=v_hour and verified_rewarded_play_credits.status='issued'
      order by verified_rewarded_play_credits.issued_at,verified_rewarded_play_credits.id for update skip locked limit 1;
    if not found then raise exception 'No official plays remain for this New York hour.' using errcode = 'P0001'; end if;
    v_source := 'rewarded';
  end if;

  select * into v_session from public.rtw_start_official_game_session_v3(p_player_id,p_game_slug,p_gameplay_version,p_seed);
  update private.official_play_start_requests set game_session_id=v_session.id, allowance_source=v_source
    where official_play_start_requests.player_id=p_player_id and official_play_start_requests.game_id=v_game_id and official_play_start_requests.request_id=p_start_request_id;
  if v_source='rewarded' then update private.verified_rewarded_play_credits set status='consumed', consumed_at=now(), consumed_session_id=v_session.id where verified_rewarded_play_credits.id=v_credit.id; end if;
  select count(*) into v_rewarded_remaining from private.verified_rewarded_play_credits as credit where credit.player_id=p_player_id and credit.game_id=v_game_id and credit.hour_started_at=v_hour and credit.status='issued';
  return query select v_session.id,v_session.gameplay_version,v_session.seed,v_session.started_at,v_session.expires_at,v_session.checkpoint_interval_score,v_session.activity_lease_expires_at,v_source,greatest(0,5-v_used),v_rewarded_remaining,v_hour,v_hour+interval '1 hour';
end;
$$;

revoke all on function private.official_play_hour_start(timestamptz) from public, anon, authenticated;
revoke all on function public.rtw_read_official_play_allowance(uuid,text) from public, anon, authenticated;
revoke all on function public.rtw_start_official_game_session_v4(uuid,text,text,bigint,uuid) from public, anon, authenticated;
grant execute on function public.rtw_read_official_play_allowance(uuid,text) to service_role;
grant execute on function public.rtw_start_official_game_session_v4(uuid,text,text,bigint,uuid) to service_role;

-- Share remains a voluntary personal invitation link. Historical referral and
-- financial evidence is intentionally retained, but no future validated run
-- can qualify a referral or mint a weekly-share prize.
create or replace function private.after_validated_run_change()
returns trigger language plpgsql set search_path = '' as $$
declare v_game_id uuid; v_week_start date; v_observation private.game_session_antifraud_observations%rowtype;
begin
  if tg_op = 'DELETE' then
    v_game_id := old.game_id; v_week_start := old.tournament_week_start;
  else
    v_game_id := new.game_id; v_week_start := new.tournament_week_start;
    if tg_op = 'INSERT' and new.eligibility_status = 'under_review' then
      select * into v_observation from private.game_session_antifraud_observations where game_session_id = new.game_session_id;
      insert into public.fraud_flags (player_id, game_id, subject_type, subject_id, severity, status, signal_summary, signal_data)
      values (new.player_id, new.game_id, 'validated_run', new.id, 'medium', 'under_review', 'Server-observed anti-automation signals require review.', jsonb_build_object('signal_codes', coalesce(to_jsonb(v_observation.signal_codes), '[]'::jsonb))) on conflict do nothing;
      insert into public.fraud_reviews (subject_type, subject_id, status, decision_note)
      values ('validated_run', new.id, 'under_review', 'Server-observed anti-automation signals require review.') on conflict (subject_type, subject_id) do nothing;
    end if;
  end if;
  perform private.refresh_competition_week(v_game_id, v_week_start);
  return null;
end;
$$;

-- Disable only future Share award generation. Existing awards, ledger records,
-- balances and referral history are preserved untouched.
create or replace function private.refresh_weekly_share_results(p_game_id uuid, p_week_start date)
returns void language plpgsql security definer set search_path = '' as $$ begin return; end; $$;
create or replace function private.reconcile_weekly_share_prize_pool(p_game_id uuid, p_week_start date, p_mark_official_generation boolean default false, p_actor_user_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$ begin return; end; $$;
revoke all on function private.after_validated_run_change(), private.refresh_weekly_share_results(uuid,date), private.reconcile_weekly_share_prize_pool(uuid,date,boolean,uuid) from public, anon, authenticated;
grant execute on function private.refresh_weekly_share_results(uuid,date), private.reconcile_weekly_share_prize_pool(uuid,date,boolean,uuid) to service_role;
