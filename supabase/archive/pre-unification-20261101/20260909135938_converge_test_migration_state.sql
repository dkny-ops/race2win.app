-- Forward-only convergence from TEST's seven recorded migrations.
-- Historical files and remote history stay unchanged. Capture formerly
-- unrecorded Share fixes, and remove platform-default service_role privileges.
-- Apply in one transaction, only after the documented history/state preflight.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('rtw:migration:converge-test-state', 0));

create unique index if not exists provisional_winners_one_weekly_tournament_award_idx
  on public.provisional_winners (game_id, tournament_week_start, award_type, player_id)
  where award_type = 'weekly_tournament';

create or replace function private.reconcile_weekly_share_prize_pool(
  p_game_id uuid,
  p_week_start date,
  p_mark_official_generation boolean default false,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pool_cents integer := private.weekly_share_prize_pool_cents();
  v_winner_count integer;
  v_has_generated boolean;
  v_paid_conflict boolean := false;
  v_winner public.provisional_winners%rowtype;
  v_share record;
  v_revision integer;
  v_has_history boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text || ':shares:' || p_week_start::text, 0));

  if p_mark_official_generation then
    insert into private.competition_award_generations (
      game_id, tournament_week_start, award_type, generated_by_user_id
    ) values (
      p_game_id, p_week_start, 'weekly_shares', p_actor_user_id
    ) on conflict (game_id, tournament_week_start, award_type) do nothing;
  end if;

  select count(*)::integer into v_winner_count
  from public.weekly_share_results
  where game_id = p_game_id
    and tournament_week_start = p_week_start
    and is_winner;

  if v_winner_count > v_pool_cents then
    raise exception 'Share winner count exceeds the whole-cent prize pool.' using errcode = '23514';
  end if;

  select exists (
    select 1 from private.competition_award_generations as generated
    where generated.game_id = p_game_id
      and generated.tournament_week_start = p_week_start
      and generated.award_type = 'weekly_shares'
  ) or exists (
    select 1 from public.provisional_winners as winner
    where winner.game_id = p_game_id
      and winner.tournament_week_start = p_week_start
      and winner.award_type = 'weekly_shares'
  ) into v_has_generated;

  if not v_has_generated then
    return;
  end if;

  -- A paid payout (or a paid payout allocation while the winner row lags) is
  -- a hard stop. Flag every changed record and leave the entire current pool
  -- untouched, avoiding a partial reallocation or double payment.
  for v_winner in
    select winner.*
    from public.provisional_winners as winner
    where winner.game_id = p_game_id
      and winner.tournament_week_start = p_week_start
      and winner.award_type = 'weekly_shares'
      and winner.allocation_status = 'allocated'
      and winner.status not in ('disqualified', 'expired')
      and not exists (
        select 1
        from public.weekly_share_results as share
        where share.game_id = p_game_id
          and share.tournament_week_start = p_week_start
          and share.is_winner
          and share.player_id = winner.player_id
          and share.rank_position = winner.rank_position
          and winner.amount_cents = (
            (v_pool_cents / nullif(v_winner_count, 0))
            + case when (
              select count(*)
              from public.weekly_share_results as earlier
              where earlier.game_id = p_game_id
                and earlier.tournament_week_start = p_week_start
                and earlier.is_winner
                and earlier.player_id <= share.player_id
            ) <= mod(v_pool_cents, nullif(v_winner_count, 0)) then 1 else 0 end
          )
      )
    for update
  loop
    if v_winner.status = 'paid' or exists (
      select 1
      from public.prize_ledger_entries as credit
      join public.payout_credit_allocations as allocation on allocation.credit_ledger_entry_id = credit.id
      join public.payouts as payout on payout.id = allocation.payout_id
      where credit.provisional_winner_id = v_winner.id
        and credit.entry_type = 'credit'
        and payout.status = 'paid'
    ) then
      perform private.flag_paid_winner_for_review(v_winner, p_actor_user_id);
      v_paid_conflict := true;
    end if;
  end loop;

  if v_paid_conflict then
    return;
  end if;

  -- Supersede every allocation that is no longer the canonical winner/amount.
  -- An approved award is first countered by a single immutable credit reversal;
  -- reverse_provisional_winner_credit also releases any unpaid payout hold.
  for v_winner in
    select winner.*
    from public.provisional_winners as winner
    where winner.game_id = p_game_id
      and winner.tournament_week_start = p_week_start
      and winner.award_type = 'weekly_shares'
      and winner.allocation_status = 'allocated'
      and winner.status not in ('disqualified', 'expired')
      and not exists (
        select 1
        from public.weekly_share_results as share
        where share.game_id = p_game_id
          and share.tournament_week_start = p_week_start
          and share.is_winner
          and share.player_id = winner.player_id
          and share.rank_position = winner.rank_position
          and winner.amount_cents = (
            (v_pool_cents / nullif(v_winner_count, 0))
            + case when (
              select count(*)
              from public.weekly_share_results as earlier
              where earlier.game_id = p_game_id
                and earlier.tournament_week_start = p_week_start
                and earlier.is_winner
                and earlier.player_id <= share.player_id
            ) <= mod(v_pool_cents, nullif(v_winner_count, 0)) then 1 else 0 end
          )
      )
    for update
  loop
    if v_winner.status = 'approved_for_payment'
      and not private.reverse_provisional_winner_credit(v_winner.id, p_actor_user_id) then
      raise exception 'A paid Share prize cannot be automatically reconciled.' using errcode = '23514';
    end if;

    perform set_config('app.rtw_share_prize_reconcile', 'on', true);
    update public.provisional_winners
    set allocation_status = 'superseded',
        status = 'under_review',
        reviewed_at = coalesce(reviewed_at, now()),
        admin_note = coalesce(admin_note, 'Share prize allocation superseded by a server-side competition correction.')
    where id = v_winner.id;
  end loop;

  -- Insert precisely the canonical current set. The active-allocation index
  -- and pool guard are separate database backstops; this loop is serialized by
  -- the same advisory key and cannot add a second current allocation.
  for v_share in
    select share.*, row_number() over (order by share.player_id) as deterministic_order
    from public.weekly_share_results as share
    where share.game_id = p_game_id
      and share.tournament_week_start = p_week_start
      and share.is_winner
    order by share.player_id
  loop
    if exists (
      select 1
      from public.provisional_winners as winner
      where winner.game_id = p_game_id
        and winner.tournament_week_start = p_week_start
        and winner.award_type = 'weekly_shares'
        and winner.player_id = v_share.player_id
        and winner.rank_position = v_share.rank_position
        and winner.amount_cents = (v_pool_cents / nullif(v_winner_count, 0))
          + case when v_share.deterministic_order <= mod(v_pool_cents, nullif(v_winner_count, 0)) then 1 else 0 end
        and winner.allocation_status = 'allocated'
        and winner.status not in ('disqualified', 'expired')
    ) then
      continue;
    end if;

    select coalesce(max(winner.allocation_revision), 0) + 1,
           exists (
             select 1 from public.provisional_winners as historic
             where historic.game_id = p_game_id
               and historic.tournament_week_start = p_week_start
               and historic.award_type = 'weekly_shares'
               and historic.player_id = v_share.player_id
           )
    into v_revision, v_has_history
    from public.provisional_winners as winner
    where winner.game_id = p_game_id
      and winner.tournament_week_start = p_week_start
      and winner.award_type = 'weekly_shares'
      and winner.player_id = v_share.player_id;

    insert into public.provisional_winners (
      game_id, player_id, tournament_week_start, award_type, rank_position,
      amount_cents, allocation_status, allocation_revision, status, claim_deadline_at, admin_note
    ) values (
      p_game_id,
      v_share.player_id,
      p_week_start,
      'weekly_shares',
      v_share.rank_position,
      (v_pool_cents / nullif(v_winner_count, 0))
        + case when v_share.deterministic_order <= mod(v_pool_cents, nullif(v_winner_count, 0)) then 1 else 0 end,
      'allocated',
      v_revision,
      case when v_has_history then 'under_review' else 'provisional' end,
      ((p_week_start + 14)::timestamp at time zone 'America/New_York'),
      case when v_has_history then 'Share prize allocation requires review after a competition correction.' else null end
    );
  end loop;
end;
$$;

create or replace function public.rtw_generate_provisional_winners(
  p_actor_user_id uuid,
  p_game_slug text,
  p_week_start date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
begin
  if not exists (
    select 1 from private.admin_users
    where user_id = p_actor_user_id and is_active
  ) then
    raise exception 'Administrator authorization is required.' using errcode = '42501';
  end if;
  if now() < ((p_week_start + 7)::timestamp at time zone 'America/New_York') then
    raise exception 'Weekly winners cannot be generated before the week closes.' using errcode = '22023';
  end if;
  select id into v_game_id from public.games where slug = p_game_slug;
  if not found then raise exception 'Game is unavailable.' using errcode = '22023'; end if;

  perform private.refresh_competition_week(v_game_id, p_week_start);
  perform private.refresh_weekly_share_results(v_game_id, p_week_start);

  insert into public.provisional_winners (
    game_id, player_id, tournament_week_start, award_type, rank_position,
    amount_cents, allocation_status, claim_deadline_at
  )
  select
    total.game_id,
    total.player_id,
    total.tournament_week_start,
    'weekly_tournament',
    total.rank_position,
    case total.rank_position when 1 then 1500 when 2 then 300 when 3 then 200 end,
    'allocated',
    ((p_week_start + 14)::timestamp at time zone 'America/New_York')
  from public.weekly_tournament_totals as total
  where total.game_id = v_game_id
    and total.tournament_week_start = p_week_start
    and total.rank_position between 1 and 3
    and total.tie_break_status = 'resolved'
    and not exists (
      select 1 from public.weekly_tournament_totals as earlier
      where earlier.game_id = total.game_id
        and earlier.tournament_week_start = total.tournament_week_start
        and earlier.rank_position < total.rank_position
        and earlier.tie_break_status = 'exact_tie'
    )
  on conflict do nothing;

  perform private.reconcile_weekly_share_prize_pool(v_game_id, p_week_start, true, p_actor_user_id);
end;
$$;

revoke all on function private.reconcile_weekly_share_prize_pool(uuid,date,boolean,uuid) from public, anon, authenticated;
revoke all on function public.rtw_generate_provisional_winners(uuid,text,date) from public, anon, authenticated;
grant execute on function private.reconcile_weekly_share_prize_pool(uuid,date,boolean,uuid) to service_role;
grant execute on function public.rtw_generate_provisional_winners(uuid,text,date) to service_role;

-- Row triggers do not intercept TRUNCATE. Remove inherited platform defaults
-- on this application's tables, then restore the explicit runtime allowlist.
-- Preserve UPDATE(id) on the ledger for SELECT FOR UPDATE; mutations still fail.
revoke all on table public.ad_reward_claims from service_role;
revoke all on table public.daily_top_scores from service_role;
revoke all on table public.fraud_flags from service_role;
revoke all on table public.fraud_reviews from service_role;
revoke all on table public.game_sessions from service_role;
revoke all on table public.games from service_role;
revoke all on table public.normal_ad_delivery_events from service_role;
revoke all on table public.payout_credit_allocations from service_role;
revoke all on table public.payouts from service_role;
revoke all on table public.player_eligibility_records from service_role;
revoke all on table public.prize_balances from service_role;
revoke all on table public.prize_ledger_entries from service_role;
revoke all on table public.profiles from service_role;
revoke all on table public.provisional_winners from service_role;
revoke all on table public.referral_codes from service_role;
revoke all on table public.referral_qualification_days from service_role;
revoke all on table public.referrals from service_role;
revoke all on table public.validated_runs from service_role;
revoke all on table public.weekly_share_results from service_role;
revoke all on table public.weekly_tournament_totals from service_role;
grant insert, select, update on table public.ad_reward_claims to service_role;
grant delete, insert, select on table public.daily_top_scores to service_role;
grant insert, select, update on table public.fraud_flags to service_role;
grant insert, select, update on table public.fraud_reviews to service_role;
grant insert, select, update on table public.game_sessions to service_role;
grant select on table public.games to service_role;
grant insert, select, update on table public.normal_ad_delivery_events to service_role;
grant insert, select, update on table public.payout_credit_allocations to service_role;
grant insert, select, update on table public.payouts to service_role;
grant insert, select, update on table public.player_eligibility_records to service_role;
grant insert, select, update on table public.prize_balances to service_role;
grant insert, select on table public.prize_ledger_entries to service_role;
grant insert, select, update on table public.provisional_winners to service_role;
grant insert, select, update on table public.referral_codes to service_role;
grant insert, select, update on table public.referral_qualification_days to service_role;
grant insert, select, update on table public.referrals to service_role;
grant insert, select, update on table public.validated_runs to service_role;
grant delete, insert, select on table public.weekly_share_results to service_role;
grant delete, insert, select, update on table public.weekly_tournament_totals to service_role;
grant update (id) on table public.prize_ledger_entries to service_role;

-- Invoker referral/finalize triggers reach this constant helper through Share
-- reconciliation. Browser roles remain revoked; no definer escalation needed.
grant execute on function private.weekly_share_prize_pool_cents() to service_role;
