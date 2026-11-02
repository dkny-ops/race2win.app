create or replace function public.flappy_read_ranking(p_week date,p_page integer)
returns jsonb language sql stable security definer set search_path='' as $$
 with standings as (
  select s.player_id,s.weekly_total,s.scores,s.rank_position,s.review_required,p.username
  from private.flappy_standings(p_week) s join public.profiles p on p.user_id=s.player_id
  where p.username is not null and not exists(select 1 from private.flappy_week_closures where week=p_week)
  union all
  select r.player_id,r.weekly_total,r.scores,r.rank_position,r.review_required,r.username from private.flappy_week_results r where r.week=p_week
 ), page as (
  select * from standings order by weekly_total desc,scores desc,username,player_id limit 50 offset (p_page-1)*50
 )
 select case when p_page between 1 and 100 and extract(isodow from p_week)=1 then
 jsonb_build_object('officialEnabled',coalesce((select enabled from private.flappy_control where singleton),false) and exists(select 1 from public.games where slug='flappy-race' and status='active'),'entries',coalesce((select jsonb_agg(jsonb_build_object('rank',rank_position,'username',username,'weeklyTotal',weekly_total,'reviewRequired',review_required) order by weekly_total desc,scores desc,username,player_id) from page),'[]'::jsonb),
 'hasNextPage',(select count(*) from standings)>p_page*50 and p_page<100) else null end;
$$;


revoke all on function public.flappy_read_ranking(date,integer) from public,anon,authenticated;
grant execute on function public.flappy_read_ranking(date,integer) to service_role;
