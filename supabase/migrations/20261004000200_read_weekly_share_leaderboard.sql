-- Public Share standings need only rank, public username, and the server-
-- confirmed referral count. Keep the source tables and private eligibility
-- evidence unavailable to browser roles.
create or replace function public.rtw_read_weekly_share_leaderboard(
  p_game_id uuid,
  p_tournament_week_start date,
  p_limit integer default 10
)
returns table (
  rank_position integer,
  username text,
  confirmed_share_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_game_id is null
    or p_tournament_week_start is null
    or extract(isodow from p_tournament_week_start) <> 1
    or p_limit is null
    or p_limit < 1
    or p_limit > 10 then
    raise exception 'Invalid Share leaderboard request.' using errcode = '22023';
  end if;

  return query
  select
    result.rank_position,
    profile.username,
    result.confirmed_share_count
  from public.weekly_share_results as result
  join public.profiles as profile on profile.user_id = result.player_id
  where result.game_id = p_game_id
    and result.tournament_week_start = p_tournament_week_start
    and profile.username is not null
    and char_length(profile.username) between 1 and 40
  order by result.rank_position asc, result.player_id asc
  limit p_limit;
end;
$$;

alter function public.rtw_read_weekly_share_leaderboard(uuid, date, integer) owner to postgres;
revoke all on function public.rtw_read_weekly_share_leaderboard(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.rtw_read_weekly_share_leaderboard(uuid, date, integer) to service_role;
