-- Server-only personal FlappyRace weekly score read model.
-- No score, prize, payment, advertisement, or game-state mutation is performed.
create or replace function public.flappy_read_personal_week(p_player uuid, p_week date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with calendar as (
    select (p_week + day_offset)::date as tournament_day
    from generate_series(0, 6) as day_offset
  ),
  ranked as (
    select
      r.tournament_day,
      r.score,
      r.session_id,
      row_number() over (
        partition by r.tournament_day
        order by r.score desc, r.session_id
      ) as daily_rank
    from private.flappy_runs r
    join public.games g on g.id = r.game_id and g.slug = 'flappy-race'
    where r.player_id = p_player
      and r.tournament_week_start = p_week
      and r.eligibility = 'valid'
  ),
  daily as (
    select
      c.tournament_day,
      coalesce(
        jsonb_agg(r.score order by r.daily_rank) filter (where r.daily_rank <= 7),
        '[]'::jsonb
      ) as top_scores,
      coalesce(sum(r.score) filter (where r.daily_rank <= 7), 0)::bigint as daily_total
    from calendar c
    left join ranked r on r.tournament_day = c.tournament_day
    group by c.tournament_day
  )
  select case
    when p_player is null or p_week is null or extract(isodow from p_week) <> 1 then null
    else jsonb_build_object(
      'week', p_week,
      'weeklyTotal', coalesce((select sum(d.daily_total) from daily d), 0),
      'days', (select jsonb_agg(
        jsonb_build_object(
          'day', d.tournament_day,
          'topScores', d.top_scores,
          'dailyTotal', d.daily_total
        )
        order by d.tournament_day
      ) from daily d)
    )
  end;
$$;

revoke all on function public.flappy_read_personal_week(uuid, date) from public, anon, authenticated;
grant execute on function public.flappy_read_personal_week(uuid, date) to service_role;
