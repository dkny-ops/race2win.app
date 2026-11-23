-- Keep Flappy's public ranking and weekly closure tied to exactly the same
-- seven verified runs that contribute to each daily total. In particular,
-- a verified score of 1 is a valid counting run until seven higher-or-equal
-- runs for that player/day displace it. This changes no historical run,
-- balance, prize, payout, permission, or eligibility state.
create or replace function private.flappy_standings(p_week date)
returns table(player_id uuid,weekly_total bigint,scores integer[],rank_position bigint,review_required boolean)
language sql stable security definer set search_path='' as $$
 with daily as (
  select r.*,row_number() over(partition by r.player_id,r.tournament_day order by r.score desc,r.session_id) daily_rank
  from private.flappy_runs r join public.games g on g.id=r.game_id and g.slug='flappy-race'
  where r.tournament_week_start=p_week and r.eligibility='valid'
 ), vectors as (
  select d.player_id,
   sum(d.score) filter(where d.daily_rank<=7)::bigint total,
   array_agg(d.score order by d.score desc,d.session_id) filter(where d.daily_rank<=7) score_vector
  from daily d group by d.player_id
 ), ranked as (
  select v.*,rank() over(order by v.total desc,v.score_vector desc) position,
   count(*) over(partition by v.total,v.score_vector)>1 tied from vectors v
 )
 select r.player_id,r.total,r.score_vector,case when r.tied then null else r.position end,r.tied from ranked r;
$$;

revoke all on function private.flappy_standings(date) from public, anon, authenticated, service_role;
