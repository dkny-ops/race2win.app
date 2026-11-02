create or replace function public.rtw_read_last_week_prizes(p_game_id uuid, p_week date)
returns jsonb language sql stable security definer set search_path = ''
as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'rank', w.rank_position, 'username', p.username,
 'weeklyTotal', w.weekly_total_score,
 'amountCents', a.amount_cents,
 'awardStatus', a.status
 ) order by w.rank_position, w.player_id), '[]'::jsonb)
 from public.weekly_tournament_totals w
 join public.profiles p on p.user_id=w.player_id
 left join lateral (
 select pw.amount_cents, pw.status from public.provisional_winners pw
 where pw.game_id=w.game_id and pw.player_id=w.player_id
 and pw.tournament_week_start=w.tournament_week_start
 and pw.award_type='weekly_tournament'
 and pw.rank_position=w.rank_position
 and pw.status not in ('disqualified','void')
 order by pw.created_at desc limit 1
 ) a on true
 where w.game_id=p_game_id and w.tournament_week_start=p_week
 and w.rank_position between 1 and 3 and p.username is not null
 and char_length(p.username) between 1 and 40
 and p_week < (timezone('America/New_York', now())::date - (extract(isodow from timezone('America/New_York', now()))::int - 1))
 and extract(isodow from p_week)=1
$$;
revoke all on function public.rtw_read_last_week_prizes(uuid,date) from public, anon, authenticated;
grant execute on function public.rtw_read_last_week_prizes(uuid,date) to service_role;;
