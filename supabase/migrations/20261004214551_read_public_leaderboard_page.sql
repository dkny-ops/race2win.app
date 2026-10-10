-- The public leaderboard is filtered to public usernames before pagination.
-- It deliberately returns no player identifier, profile details, tie-break
-- vector, or financial data. The application calls it only with service_role.
create function public.rtw_read_public_leaderboard_page(
  p_game_id uuid,
  p_tournament_week_start date,
  p_page integer,
  p_page_size integer
)
returns table (
  rank_position integer,
  username text,
  weekly_total_score bigint,
  total_public_entries bigint
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
    or p_page is null
    or p_page < 1
    or p_page > 100
    or p_page_size is null
    or p_page_size < 1
    or p_page_size > 50 then
    raise exception 'Invalid public leaderboard request.' using errcode = '22023';
  end if;

  return query
  with public_rows as materialized (
    select
      total.rank_position,
      profile.username,
      total.weekly_total_score,
      total.player_id
    from public.weekly_tournament_totals as total
    join public.profiles as profile on profile.user_id = total.player_id
    where total.game_id = p_game_id
      and total.tournament_week_start = p_tournament_week_start
      and profile.username is not null
      and char_length(profile.username) between 1 and 40
  )
  select
    public_rows.rank_position,
    public_rows.username,
    public_rows.weekly_total_score,
    count(*) over () as total_public_entries
  from public_rows
  order by public_rows.rank_position asc, public_rows.player_id asc
  offset (p_page - 1) * p_page_size
  limit p_page_size;
end;
$$;

alter function public.rtw_read_public_leaderboard_page(uuid, date, integer, integer) owner to postgres;
revoke all on function public.rtw_read_public_leaderboard_page(uuid, date, integer, integer) from public, anon, authenticated;
grant execute on function public.rtw_read_public_leaderboard_page(uuid, date, integer, integer) to service_role;
