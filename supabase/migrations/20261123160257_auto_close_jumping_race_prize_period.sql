-- Automatically freezes only the prior completed Jumping Race prize period.
-- It never creates a balance entry, approves a candidate, or records a payment.

create or replace function public.jr_close_prize_period(p_actor uuid, p_week date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p private.jumping_race_prize_program%rowtype;
        v_current_week date := date_trunc('week', (clock_timestamp() at time zone 'America/New_York')::date)::date;
        v_previous_week date := date_trunc('week', (clock_timestamp() at time zone 'America/New_York')::date)::date - 7;
begin
  if p_week is null or extract(isodow from p_week) <> 1 or p_week >= v_current_week then
    raise exception 'Prize closure unavailable' using errcode = '42501';
  end if;
  if p_actor is null then
    if p_week is distinct from v_previous_week
       or clock_timestamp() < ((p_week + 7)::timestamp at time zone 'America/New_York') + interval '11 minutes' then
      raise exception 'Automated prize closure unavailable' using errcode = '42501';
    end if;
  elsif not private.jr_is_confirmed_financial_owner(p_actor) then
    raise exception 'Prize closure unavailable' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jumping-race:prize:week:' || p_week::text, 0));
  select * into p from private.jumping_race_prize_program where singleton and enabled for update;
  if not found or p_week < p.inaugural_week_start then
    raise exception 'Prize period unavailable' using errcode = 'P0001';
  end if;
  if exists (select 1 from private.jumping_race_prize_period_results where week = p_week) then
    return jsonb_build_object('week', p_week, 'idempotent', true, 'paymentsEnabled', false);
  end if;
  insert into private.jumping_race_prize_period_results
    (week, player_id, username, weekly_total, scores, rank_position, review_required)
  select p_week, s.player_id, s.username, s.weekly_total, s.scores, s.rank_position, s.review_required
  from private.jr_prize_standings(p_week) s;
  perform private.jr_open_prize_cases(p_week);
  return jsonb_build_object('week', p_week, 'idempotent', false, 'paymentsEnabled', false);
end;
$$;

create or replace function private.jr_auto_close_previous_week()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_week date := date_trunc('week', (clock_timestamp() at time zone 'America/New_York')::date)::date - 7;
begin
  return public.jr_close_prize_period(null, v_week);
exception when others then
  return jsonb_build_object('week', v_week, 'status', 'not_ready', 'paymentsEnabled', false);
end;
$$;

revoke all on function public.jr_close_prize_period(uuid, date) from public, anon, authenticated;
grant execute on function public.jr_close_prize_period(uuid, date) to service_role;
revoke all on function private.jr_auto_close_previous_week() from public, anon, authenticated, service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'jumping_race_auto_close_previous_week') then
      update cron.job
      set schedule = '30 5 * * *', command = 'select private.jr_auto_close_previous_week();', active = true
      where jobname = 'jumping_race_auto_close_previous_week';
    else
      perform cron.schedule(
        'jumping_race_auto_close_previous_week',
        '30 5 * * *',
        'select private.jr_auto_close_previous_week();'
      );
    end if;
  end if;
end $$;
