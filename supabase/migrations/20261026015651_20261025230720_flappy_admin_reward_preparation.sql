-- Proposed only. Requires approval + verified production backup before application.
-- Depends on 20261025221423; no shared score, auth, reward or financial writes.
-- This ledger reserves a future single reward slot; no grant/consume RPC exists.
-- No provider has been connected and no versioned resume protocol is approved.
create table private.flappy_reward_reservations (
  session_id uuid primary key references private.flappy_sessions(id) on delete restrict,
  kind text not null check(kind='extra_life'),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.flappy_reward_reservations enable row level security;
revoke all on private.flappy_reward_reservations from public,anon,authenticated,service_role;
-- One slot per server-owned session prevents repeated/mixed reward reservations.
-- Only a separately reviewed future migration can add verified grants/consumption.
-- Do not accept adViewed, rewardGranted or provider receipts from a browser.

create function public.flappy_admin_read(p_actor uuid,p_page integer,p_session uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from private.admin_users where user_id=p_actor and is_active)
    or p_page is null or p_page not between 1 and 100 then raise exception 'Review unavailable'; end if;
  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.session_id),'[]'::jsonb) into result from (
    select s.id session_id,s.player_id,p.username,s.created_at,s.status,s.version,
      s.tick,s.digest,cardinality(s.inputs) input_count,
      r.score,r.collision_tick,r.completed_at,r.tournament_day,r.tournament_week_start,
      r.verification,r.eligibility,r.reviewed_at,r.review_note,
      -- Detail evidence is available only through this server-only RPC.
      case when p_session is not null then s.seed else null end seed,
      case when p_session is not null then s.inputs else null end inputs,
      exists(select 1 from private.flappy_reward_reservations x where x.session_id=s.id) reward_reserved
    from private.flappy_sessions s
    join public.games g on g.id=s.game_id and g.slug='flappy-race'
    left join private.flappy_runs r on r.session_id=s.id
    left join public.profiles p on p.user_id=s.player_id
    where p_session is null or s.id=p_session
    order by s.created_at desc,s.id limit 50 offset (p_page-1)*50
  ) rows;
  return result;
end $$;
revoke all on function public.flappy_admin_read(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.flappy_admin_read(uuid,integer,uuid) to service_role;
-- Recovery: close both existing competition gates; retain evidence. Never auto-drop.
