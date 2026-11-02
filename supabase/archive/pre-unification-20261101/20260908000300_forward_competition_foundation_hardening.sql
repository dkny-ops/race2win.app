-- Forward-only hardening for installations that already applied the original
-- competition foundation migration. Keep historical migrations immutable.
--
-- A Share must qualify inside one America/New_York competition week. Once a
-- Share has been credited, its recorded week remains the only week that can
-- be evaluated; later activity cannot rescue or move it after disqualification.
create or replace function private.refresh_referral_qualification(p_invitee_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_referral public.referrals%rowtype;
  v_qualified_day_count integer;
  v_completion_day date;
begin
  select * into v_referral
  from public.referrals
  where invitee_user_id = p_invitee_user_id
  for update;
  if not found then return; end if;

  if not exists (
    select 1 from auth.users as user_record
    where user_record.id = p_invitee_user_id
      and user_record.email_confirmed_at is not null
  ) then
    return;
  end if;

  insert into public.referral_qualification_days (
    referral_id, qualification_day, valid_run_count, status
  )
  select
    v_referral.id,
    run.tournament_day,
    count(*)::integer,
    'valid'
  from public.validated_runs as run
  where run.player_id = p_invitee_user_id
    and run.game_id = v_referral.game_id
    and run.eligibility_status = 'valid'
    and run.completed_at >= v_referral.attached_at
  group by run.tournament_day
  having count(*) >= 3
  on conflict (referral_id, qualification_day) do update
    set valid_run_count = excluded.valid_run_count,
        status = 'valid',
        last_recalculated_at = now();

  update public.referral_qualification_days as qualification
  set status = 'disqualified', last_recalculated_at = now()
  where qualification.referral_id = v_referral.id
    and qualification.status = 'valid'
    and not exists (
      select 1
      from public.validated_runs as run
      where run.player_id = p_invitee_user_id
        and run.game_id = v_referral.game_id
        and run.eligibility_status = 'valid'
        and run.completed_at >= v_referral.attached_at
        and run.tournament_day = qualification.qualification_day
      group by run.tournament_day
      having count(*) >= 3
    );

  if v_referral.confirmed_tournament_week_start is not null then
    select count(*), max(qualification_day)
    into v_qualified_day_count, v_completion_day
    from public.referral_qualification_days
    where referral_id = v_referral.id
      and status = 'valid'
      and private.week_start_for_date(qualification_day) = v_referral.confirmed_tournament_week_start;
  else
    select count(*)::integer, (array_agg(qualification_day order by qualification_day))[5]
    into v_qualified_day_count, v_completion_day
    from public.referral_qualification_days
    where referral_id = v_referral.id
      and status = 'valid'
    group by private.week_start_for_date(qualification_day)
    order by (count(*) >= 5) desc,
      case when count(*) >= 5 then private.week_start_for_date(qualification_day) end asc,
      count(*) desc,
      private.week_start_for_date(qualification_day) asc
    limit 1;
    v_qualified_day_count := coalesce(v_qualified_day_count, 0);
  end if;

  update public.referrals
  set qualified_day_count = v_qualified_day_count,
      updated_at = now()
  where id = v_referral.id;

  if v_qualified_day_count >= 5 and v_referral.status = 'invite_pending' then
    update public.referrals
    set status = 'valid',
        confirmed_at = now(),
        confirmed_tournament_week_start = private.week_start_for_date(v_completion_day),
        updated_at = now()
    where id = v_referral.id;
  elsif v_qualified_day_count < 5 and v_referral.status = 'valid' then
    update public.referrals
    set status = 'under_review', updated_at = now()
    where id = v_referral.id;
  end if;
end;
$$;

-- Server-side invoker triggers create derived competition data during an
-- authoritative finalization. Grant only the exact helpers and derived-table
-- writes they require; browser roles retain the historical revocations.
grant usage on schema private to service_role;
grant execute on function
  private.ny_tournament_day(timestamptz),
  private.week_start_for_date(date),
  private.ny_tournament_week_start(timestamptz),
  private.refresh_competition_week(uuid, date),
  private.refresh_referral_qualification(uuid),
  private.refresh_weekly_share_results(uuid, date),
  private.reconcile_stale_competition_winners(uuid, date, text),
  private.reverse_provisional_winner_credit(uuid, uuid),
  private.release_unsettled_payout_holds(uuid, uuid, uuid),
  private.flag_paid_winner_for_review(public.provisional_winners, uuid)
to service_role;

grant insert, delete on public.daily_top_scores to service_role;
grant insert, update, delete on public.weekly_tournament_totals to service_role;
grant insert, delete on public.weekly_share_results to service_role;
grant insert, update on public.prize_balances to service_role;
-- Row locking requires UPDATE privilege; the immutable-ledger trigger still
-- rejects every actual UPDATE, including id = id.
grant update (id) on public.prize_ledger_entries to service_role;
grant usage on schema auth to service_role;
grant select (id, email_confirmed_at) on auth.users to service_role;

revoke all on function private.refresh_referral_qualification(uuid) from public, anon, authenticated;
