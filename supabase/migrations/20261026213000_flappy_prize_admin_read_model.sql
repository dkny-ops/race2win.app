-- Administrative-only read model for the separately frozen FlappyRace prize period.
-- It exposes no raw inputs or seeds and does not create any credit.
create function public.flappy_admin_read_prize_cases(p_actor uuid,p_week date)
returns jsonb language sql stable security definer set search_path='' as $$
  with authorized as (
    select exists(select 1 from private.admin_users where user_id=p_actor and is_active) as allowed
  ), program as (
    select enabled,activated_at,inaugural_week_start from private.flappy_prize_program where singleton
  ), cases as (
    select c.week,c.player_id,c.opening_rank,c.state,c.reviewed_at,c.review_note,c.created_at,
      r.username,r.weekly_total,r.scores,ec.effective_rank
    from private.flappy_prize_winner_cases c
    join private.flappy_prize_period_results r on r.week=c.week and r.player_id=c.player_id
    left join private.flappy_prize_effective_candidates(p_week) ec on ec.player_id=c.player_id
    where c.week=p_week
  ), packed as (
    select jsonb_build_object(
      'playerId',c.player_id,
      'username',c.username,
      'openingRank',c.opening_rank,
      'effectiveRank',c.effective_rank,
      'state',c.state,
      'weeklyTotal',c.weekly_total,
      'scores',c.scores,
      'createdAt',c.created_at,
      'reviewedAt',c.reviewed_at,
      'reviewNote',c.review_note,
      'dailyTopSeven',coalesce((
        select jsonb_agg(jsonb_build_object('day',x.tournament_day,'runs',x.runs) order by x.tournament_day)
        from (
          select d.tournament_day,jsonb_agg(jsonb_build_object(
            'sessionId',d.session_id,'score',d.score,'completedAt',d.completed_at,
            'collisionTick',d.collision_tick,'digest',s.digest,'version',s.version,
            'inputCount',cardinality(s.inputs),'replayVerified',(s.outcome->>'verification'='replay_verified')
          ) order by d.score desc,d.session_id) as runs
          from (
            select r0.*,row_number() over(partition by r0.tournament_day order by r0.score desc,r0.session_id) as daily_rank
            from private.flappy_runs r0
            join private.flappy_sessions s0 on s0.id=r0.session_id
            cross join program p
            where r0.player_id=c.player_id and r0.tournament_week_start=p_week
              and r0.eligibility='valid' and s0.starts_at>=p.activated_at
          ) d join private.flappy_sessions s on s.id=d.session_id
          where d.daily_rank<=7
          group by d.tournament_day
        ) x
      ),'[]'::jsonb),
      'history',coalesce((
        select jsonb_agg(jsonb_build_object('decision',e.decision,'note',e.note,'at',e.created_at) order by e.created_at)
        from private.flappy_prize_winner_case_events e
        where e.week=c.week and e.player_id=c.player_id
      ),'[]'::jsonb)
    ) as value,
    coalesce(c.effective_rank,999) as display_rank,c.created_at
    from cases c
  )
  select case when (select allowed from authorized) and extract(isodow from p_week)=1 then
    jsonb_build_object(
      'week',p_week,
      'enabled',(select enabled from program),
      'activatedAt',(select activated_at from program),
      'inauguralWeekStart',(select inaugural_week_start from program),
      'candidates',coalesce((select jsonb_agg(value order by display_rank,created_at) from packed),'[]'::jsonb),
      'paymentsEnabled',false
    )
  else null end;
$$;
revoke all on function public.flappy_admin_read_prize_cases(uuid,date) from public,anon,authenticated;
grant execute on function public.flappy_admin_read_prize_cases(uuid,date) to service_role;