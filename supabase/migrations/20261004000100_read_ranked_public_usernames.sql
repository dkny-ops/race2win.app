-- A leaderboard needs only a player's chosen public username, and only when
-- that player is already ranked for the requested game/week.  Do not restore
-- direct service-role access to profiles: it also contains payout email.
create function public.rtw_read_ranked_public_usernames(
  p_game_id uuid,
  p_tournament_week_start date,
  p_player_ids uuid[]
)
returns table (
  player_id uuid,
  username text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_game_id is null
     or p_tournament_week_start is null
     or cardinality(p_player_ids) is null
     or cardinality(p_player_ids) < 1
     or cardinality(p_player_ids) > 50
     or array_position(p_player_ids, null::uuid) is not null then
    raise exception 'Invalid leaderboard lookup.' using errcode = '22023';
  end if;

  return query
  with requested as (
    select distinct requested.requested_player_id as player_id
    from unnest(p_player_ids) as requested(requested_player_id)
  ), ranked as (
    select total.player_id
    from public.weekly_tournament_totals as total
    join requested on requested.player_id = total.player_id
    where total.game_id = p_game_id
      and total.tournament_week_start = p_tournament_week_start
  )
  select profile.user_id, profile.username
  from public.profiles as profile
  join ranked on ranked.player_id = profile.user_id
  where profile.username is not null;
end;
$$;

-- The migration is executed by the controlled database owner.  The function
-- must not inherit an unreviewed runtime owner with future table privileges.
alter function public.rtw_read_ranked_public_usernames(uuid, date, uuid[]) owner to postgres;

revoke all on function public.rtw_read_ranked_public_usernames(uuid, date, uuid[]) from public, anon, authenticated;
grant execute on function public.rtw_read_ranked_public_usernames(uuid, date, uuid[]) to service_role;
