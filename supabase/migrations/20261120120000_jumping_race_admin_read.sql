-- Read model for the owner-only Jumping Race panel.
create function public.jr_admin_read(p_actor uuid, p_week date, p_search text, p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.jr_is_confirmed_financial_owner(p_actor) then
    raise exception 'Review unavailable' using errcode = '42501';
  end if;
  if p_week is null or extract(isodow from p_week) <> 1 or length(p_search) > 50 then
    raise exception 'Invalid review filters' using errcode = '22023';
  end if;

  return (
    with program as (
      select enabled, inaugural_week_start
      from private.jumping_race_prize_program where singleton
    ), candidates as (
      select c.player_id, c.username, c.weekly_total, c.scores, c.effective_rank, c.state,
        w.status as award_status, w.amount_cents,
        coalesce((
          select jsonb_agg(to_jsonb(e) order by e.created_at desc, e.id desc)
          from (
            select id, decision, note, created_at
            from private.jumping_race_prize_winner_case_events
            where week = p_week and player_id = c.player_id
            order by created_at desc, id desc limit 50
          ) e
        ), '[]'::jsonb) as events
      from private.jr_prize_effective_candidates(p_week) c
      left join public.games g on g.slug = 'jumping-race'
      left join public.provisional_winners w on w.game_id = g.id
        and w.player_id = c.player_id and w.tournament_week_start = p_week
        and w.award_type = 'weekly_tournament'
      where c.effective_rank between 1 and 3
    ), players as (
      select p.user_id, p.username
      from public.profiles p
      where (nullif(p_search, '') is null
          or p.user_id::text = lower(p_search)
          or strpos(lower(coalesce(p.username, '')), lower(p_search)) > 0)
        and exists (select 1 from private.jumping_race_sessions s where s.player_id = p.user_id)
      order by p.username, p.user_id limit 50
    ), player_runs as (
      select s.id, s.started_at, s.status, s.verification_status, s.gameplay_version,
        r.score, r.result_status, r.elapsed_ms, r.rejection_reason, r.review_reason,
        r.finalized_at, (r.finalized_at at time zone 'America/New_York')::date as tournament_day,
        r.telemetry -> 'reviewSignals' as review_signals
      from private.jumping_race_sessions s
      left join private.jumping_race_results r on r.session_id = s.id and r.player_id = s.player_id
      where s.player_id = p_player
    ), ranked as (
      select r.*, row_number() over (
        partition by tournament_day order by score desc, finalized_at, id
      ) as daily_rank
      from player_runs r
      where result_status = 'verified' and tournament_day between p_week and p_week + 6
    ), recent as (
      select * from player_runs order by started_at desc, id limit 30
    )
    select jsonb_build_object(
      'enabled', coalesce((select enabled from program), false),
      'inauguralWeek', (select inaugural_week_start from program),
      'frozen', exists (select 1 from private.jumping_race_prize_period_results where week = p_week),
      'ties', (select count(*) from private.jumping_race_prize_period_results where week = p_week and review_required),
      'candidates', coalesce((select jsonb_agg(to_jsonb(c) order by c.effective_rank) from candidates c), '[]'::jsonb),
      'players', coalesce((select jsonb_agg(to_jsonb(p) order by p.username, p.user_id) from players p), '[]'::jsonb),
      'player', (
        select jsonb_build_object('user_id', p.user_id, 'username', p.username)
        from public.profiles p where p.user_id = p_player
          and exists (select 1 from player_runs)
      ),
      'top', coalesce((select jsonb_agg(to_jsonb(r) order by tournament_day, daily_rank) from ranked r where daily_rank <= 7), '[]'::jsonb),
      'recent', coalesce((select jsonb_agg(to_jsonb(r) order by started_at desc, id) from recent r), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.jr_admin_read(uuid, date, text, uuid) from public, anon, authenticated;
grant execute on function public.jr_admin_read(uuid, date, text, uuid) to service_role;
