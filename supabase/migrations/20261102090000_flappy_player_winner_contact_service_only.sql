create or replace function public.flappy_player_winner_contact(p_player uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((
   select jsonb_build_object('week',c.week,'rankPosition',ec.effective_rank,
     'prizeCents',case ec.effective_rank when 1 then 500 when 2 then 300 when 3 then 200 end)
   from private.flappy_prize_winner_cases c
   join private.flappy_prize_effective_candidates(c.week) ec on ec.player_id=c.player_id
   join private.flappy_week_closures closure on closure.week=c.week
   join private.flappy_prize_program program on program.singleton and program.enabled
   where c.player_id=p_player and c.state in ('pending_review','needs_additional_review','approved')
     and ec.effective_rank between 1 and 3
     and not exists (
       select 1 from public.provisional_winners w join public.games g on g.id=w.game_id
       where w.player_id=p_player and w.tournament_week_start=c.week and g.slug='flappy-race'
         and w.award_type='weekly_tournament' and w.status in ('approved_for_payment','paid')
     )
   order by c.week desc limit 1
 ),'{}'::jsonb)
$$;
revoke all on function public.flappy_player_winner_contact(uuid) from public,anon,authenticated;
grant execute on function public.flappy_player_winner_contact(uuid) to service_role;