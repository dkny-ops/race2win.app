-- Jumping Race weekly competition leaderboard: 7 highest verified platform scores per NY day.
-- Isolated from Race To Win and Flappy Race. No financial side effects.
create or replace function public.jr_weekly_leaderboard(p_week date, p_page integer)
returns jsonb language sql stable security definer set search_path = '' as $$
with daily_ranked as (
 select r.player_id, r.score,
 row_number() over(partition by r.player_id, (r.finalized_at at time zone 'America/New_York')::date order by r.score desc, r.finalized_at, r.session_id) as day_rank
 from private.jumping_race_results r
 where r.result_status='verified'
 and (r.finalized_at at time zone 'America/New_York')::date between p_week and p_week+6
), counting as (
 select player_id,score from daily_ranked where day_rank <= 7
), grouped as (
 select player_id, sum(score)::bigint as weekly_total,
 array_agg(score order by score desc) as scores
 from counting group by player_id
), ordered as (
 select g.*, p.username,
 dense_rank() over(order by g.weekly_total desc, g.scores desc) as ranking,
 count(*) over(partition by g.weekly_total,g.scores) as tied
 from grouped g join public.profiles p on p.user_id=g.player_id
 where p.username is not null
), page as (
 select * from ordered order by weekly_total desc,scores desc,username,player_id
 limit 50 offset (p_page-1)*50
)
select case when p_page between 1 and 100 and extract(isodow from p_week)=1
then jsonb_build_object(
 'officialEnabled',coalesce((select enabled from private.jumping_race_control where singleton),false),
 'entries',coalesce((select jsonb_agg(jsonb_build_object('rank',case when tied>1 then null else ranking end,'username',username,'weeklyTotal',weekly_total,'reviewRequired',tied>1) order by weekly_total desc,scores desc,username,player_id) from page),'[]'::jsonb),
 'hasNextPage',(select count(*) from ordered)>p_page*50 and p_page<100
) else null end
$$;
revoke all on function public.jr_weekly_leaderboard(date,integer) from public,anon,authenticated;
grant execute on function public.jr_weekly_leaderboard(date,integer) to service_role;
