-- Return public leaderboard metadata as one bounded JSON object so the total
-- remains available when a requested page has no rows. Player ids are used
-- only as an internal deterministic tie-order and are never serialized.
create function public.rtw_read_public_leaderboard_page_metadata(
  p_game_id uuid,
  p_tournament_week_start date,
  p_page integer,
  p_page_size integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
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
  ), page_rows as (
    select
      public_rows.rank_position,
      public_rows.username,
      public_rows.weekly_total_score,
      public_rows.player_id
    from public_rows
    order by public_rows.rank_position asc, public_rows.player_id asc
    offset (p_page - 1) * p_page_size
    limit p_page_size
  )
  select jsonb_build_object(
    'total_public_entries', (select count(*) from public_rows),
    'entries', coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'rank_position', page_rows.rank_position,
          'username', page_rows.username,
          'weekly_total_score', page_rows.weekly_total_score
        )
        order by page_rows.rank_position asc, page_rows.player_id asc
      ) from page_rows),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

alter function public.rtw_read_public_leaderboard_page_metadata(uuid, date, integer, integer) owner to postgres;
revoke all on function public.rtw_read_public_leaderboard_page_metadata(uuid, date, integer, integer) from public, anon, authenticated;
grant execute on function public.rtw_read_public_leaderboard_page_metadata(uuid, date, integer, integer) to service_role;
