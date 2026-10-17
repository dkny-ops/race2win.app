-- Diagnostic only. Never invoke refresh or verification RPCs here.
begin transaction read only;

with ranked as (
  select id, game_id, player_id, tournament_day, tournament_week_start, score,
    row_number() over (partition by game_id, player_id, tournament_day
      order by score desc, completed_at, id) as daily_rank
  from public.validated_runs where eligibility_status = 'valid'
), expected as (
  select game_id, player_id, tournament_week_start, sum(score) as weekly_total_score
  from ranked where daily_rank <= 7 group by 1, 2, 3
)
select coalesce(e.tournament_week_start, t.tournament_week_start) as week,
  e.weekly_total_score as expected, t.weekly_total_score as stored
from expected e full join public.weekly_tournament_totals t
  using (game_id, player_id, tournament_week_start)
where e.weekly_total_score is distinct from t.weekly_total_score;

select r.tournament_week_start, r.score, r.eligibility_status,
  s.anti_fraud_status, o.assessment_status, v.reason,
  case when v.status = 'pending' and v.expires_at <= now() then 'expired' else v.status end as human_verification_status
from public.validated_runs r
join public.game_sessions s on s.id = r.game_session_id
left join private.game_session_antifraud_observations o on o.game_session_id = s.id
left join private.weekly_leader_human_verifications v on v.validated_run_id = r.id
where r.eligibility_status = 'under_review'
order by r.completed_at desc limit 50;

commit;
