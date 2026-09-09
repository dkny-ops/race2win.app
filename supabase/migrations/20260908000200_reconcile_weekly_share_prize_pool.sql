-- Reconcile the fixed weekly Share pool as a complete, versioned allocation.
-- Historical awards and ledger events are never rewritten. A changed unpaid
-- allocation is superseded and, if necessary, reversed through the ledger.

alter table public.provisional_winners
  add column allocation_revision integer not null default 1
    check (allocation_revision >= 1);

alter table public.provisional_winners
  drop constraint if exists provisional_winners_game_id_tournament_week_start_award_typ_key;

alter table public.provisional_winners
  add constraint provisional_winners_allocation_revision_unique
  unique (game_id, tournament_week_start, award_type, player_id, allocation_revision);

alter table public.provisional_winners
  drop constraint if exists provisional_winners_allocation_status_check;

alter table public.provisional_winners
  add constraint provisional_winners_allocation_status_check
  check (allocation_status in ('allocated', 'requires_manual_allocation', 'superseded'));

alter table public.provisional_winners
  drop constraint if exists provisional_winners_amount_shape;

alter table public.provisional_winners
  add constraint provisional_winners_amount_shape check (
    (allocation_status in ('allocated', 'superseded') and amount_cents is not null)
    or (allocation_status = 'requires_manual_allocation' and amount_cents is null)
  );

-- A player can have historical Share award revisions, but only one active
-- allocation for a given game/week. Superseded records retain audit history.
create unique index provisional_winners_one_active_share_allocation_idx
  on public.provisional_winners (game_id, tournament_week_start, award_type, player_id)
  where award_type = 'weekly_shares'
    and allocation_status = 'allocated'
    and status not in ('disqualified', 'expired');

-- Preserve the original one-award invariant for the unaffected weekly
-- tournament path while Share awards gain versioned history.
create unique index provisional_winners_one_weekly_tournament_award_idx
  on public.provisional_winners (game_id, tournament_week_start, award_type, player_id)
  where award_type = 'weekly_tournament';

-- Records that official award generation was invoked even if that week had no
-- Share winner at the time. Later corrections may then reconcile the already
-- generated competition; ordinary live qualification refreshes cannot create
-- prizes before official generation.
create table private.competition_award_generations (
  game_id uuid not null references public.games(id) on delete restrict,
  tournament_week_start date not null,
  award_type text not null check (award_type = 'weekly_shares'),
  generated_by_user_id uuid references auth.users(id) on delete restrict,
  generated_at timestamptz not null default now(),
  primary key (game_id, tournament_week_start, award_type)
);

revoke all on table private.competition_award_generations from public, anon, authenticated;

create function private.weekly_share_prize_pool_cents()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 1000;
$$;

-- This is a database-level backstop for every INSERT/UPDATE, including an
-- accidental trusted-server write. Reconciliation and the guard acquire the
-- same transaction-scoped key, so concurrent writers cannot both observe a
-- spare portion of the fixed pool.
create function private.guard_weekly_share_prize_pool()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_existing_cents bigint;
begin
  if new.award_type <> 'weekly_shares'
    or new.allocation_status <> 'allocated'
    or new.status in ('disqualified', 'expired') then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.game_id::text || ':shares:' || new.tournament_week_start::text, 0)
  );

  select coalesce(sum(winner.amount_cents), 0)
  into v_existing_cents
  from public.provisional_winners as winner
  where winner.game_id = new.game_id
    and winner.tournament_week_start = new.tournament_week_start
    and winner.award_type = 'weekly_shares'
    and winner.allocation_status = 'allocated'
    and winner.status not in ('disqualified', 'expired')
    and winner.id is distinct from new.id;

  if v_existing_cents + new.amount_cents > private.weekly_share_prize_pool_cents() then
    raise exception 'Weekly Share prize allocation exceeds the fixed pool.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger provisional_winners_guard_weekly_share_pool
  before insert or update of game_id, tournament_week_start, award_type, amount_cents, allocation_status, status
  on public.provisional_winners
  for each row execute function private.guard_weekly_share_prize_pool();

-- A confirmed Share remains permanently attached to the competition week in
-- which its fifth qualifying New York day was completed. There is intentionally
-- no ordinary writer exception: any future exceptional repair needs a separate,
-- explicitly privileged, auditable operation rather than a direct UPDATE.
create or replace function private.prevent_referral_relationship_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.game_id is distinct from old.game_id
    or new.referral_code_id is distinct from old.referral_code_id
    or new.inviter_user_id is distinct from old.inviter_user_id
    or new.invitee_user_id is distinct from old.invitee_user_id
    or new.attached_at is distinct from old.attached_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Referral ownership is immutable.' using errcode = '23514';
  end if;

  if old.confirmed_tournament_week_start is not null
    and (
      new.confirmed_tournament_week_start is distinct from old.confirmed_tournament_week_start
      or new.confirmed_at is distinct from old.confirmed_at
    ) then
    raise exception 'Confirmed Share competition week is immutable.' using errcode = '23514';
  end if;

  if old.confirmed_tournament_week_start is null
    and new.confirmed_tournament_week_start is not null
    and (new.status <> 'valid' or new.confirmed_at is null) then
    raise exception 'Share confirmation requires a valid referral and server timestamp.' using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- NULL from current_setting(..., true) is not a safe value. IS DISTINCT FROM
-- makes the ledger-only balance guard fail closed when no internal setting was
-- established by the append-only ledger trigger.
create or replace function private.guard_prize_balance_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.rtw_ledger_write', true) is distinct from 'on' then
    raise exception 'Prize balances are maintained only by the ledger.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Superseding an allocation is allowed only to the private reconciler. Normal
-- state transitions and all immutable award fields retain their existing
-- protections; paid/disqualified/expired records can never be superseded.
create or replace function private.protect_provisional_winner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reconciling boolean := current_setting('app.rtw_share_prize_reconcile', true) is not distinct from 'on';
begin
  if v_reconciling
    and old.award_type = 'weekly_shares'
    and old.allocation_status = 'allocated'
    and new.allocation_status = 'superseded'
    and new.status = 'under_review'
    and old.status not in ('paid', 'disqualified', 'expired')
    and new.id is not distinct from old.id
    and new.game_id is not distinct from old.game_id
    and new.player_id is not distinct from old.player_id
    and new.tournament_week_start is not distinct from old.tournament_week_start
    and new.award_type is not distinct from old.award_type
    and new.rank_position is not distinct from old.rank_position
    and new.amount_cents is not distinct from old.amount_cents
    and new.allocation_revision is not distinct from old.allocation_revision
    and new.claim_deadline_at is not distinct from old.claim_deadline_at
    and new.created_at is not distinct from old.created_at
    and new.claim_started_at is not distinct from old.claim_started_at
    and new.approved_at is not distinct from old.approved_at
    and new.paid_at is not distinct from old.paid_at
    and (
      new.reviewed_at is not distinct from old.reviewed_at
      or (old.reviewed_at is null and new.reviewed_at is not null)
    ) then
    new.reviewed_at := coalesce(new.reviewed_at, now());
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
    or new.game_id is distinct from old.game_id
    or new.player_id is distinct from old.player_id
    or new.tournament_week_start is distinct from old.tournament_week_start
    or new.award_type is distinct from old.award_type
    or new.rank_position is distinct from old.rank_position
    or new.amount_cents is distinct from old.amount_cents
    or new.allocation_status is distinct from old.allocation_status
    or new.allocation_revision is distinct from old.allocation_revision
    or new.claim_deadline_at is distinct from old.claim_deadline_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Provisional winner award fields are immutable.' using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if (old.status = 'provisional' and new.status not in ('claim_started', 'under_review', 'disqualified', 'expired'))
      or (old.status = 'claim_started' and new.status not in ('under_review', 'verified', 'disqualified', 'expired'))
      or (old.status = 'under_review' and new.status not in ('verified', 'disqualified'))
      or (old.status = 'verified' and new.status not in ('approved_for_payment', 'disqualified'))
      or (old.status = 'approved_for_payment' and new.status not in ('paid', 'disqualified'))
      or old.status in ('paid', 'expired', 'disqualified') then
      raise exception 'Invalid provisional winner state transition.' using errcode = '23514';
    end if;
  end if;

  if new.status = 'claim_started' and new.claim_started_at is null then new.claim_started_at := now(); end if;
  if new.status in ('verified', 'disqualified') and new.reviewed_at is null then new.reviewed_at := now(); end if;
  if new.status = 'approved_for_payment' and new.approved_at is null then new.approved_at := now(); end if;
  if new.status = 'paid' and new.paid_at is null then new.paid_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Rebuilds the complete canonical Share award set under the one game/week
-- lock. The generator never accepts an amount, a winner, or a split from the
-- caller. If any changed allocation has already reached a paid payout, no
-- replacement is made: paid history is frozen and the case is flagged.
create function private.reconcile_weekly_share_prize_pool(
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

-- A Share refresh rebuilds the canonical ranking then reconciles it only after
-- an official award-generation marker exists. Unlike the generic winner
-- reconciler, it never uses membership-only INSERT ... DO NOTHING semantics.
create or replace function private.refresh_weekly_share_results(p_game_id uuid, p_week_start date)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text || ':shares:' || p_week_start::text, 0));
  delete from public.weekly_share_results
  where game_id = p_game_id and tournament_week_start = p_week_start;

  insert into public.weekly_share_results (
    game_id, tournament_week_start, player_id, confirmed_share_count, rank_position, is_winner
  )
  select
    counted.game_id,
    p_week_start,
    counted.inviter_user_id,
    counted.confirmed_share_count,
    rank() over (order by counted.confirmed_share_count desc),
    counted.confirmed_share_count = max(counted.confirmed_share_count) over ()
  from (
    select
      referral.game_id,
      referral.inviter_user_id,
      count(*)::integer as confirmed_share_count
    from public.referrals as referral
    where referral.game_id = p_game_id
      and referral.status = 'valid'
      and referral.confirmed_tournament_week_start = p_week_start
    group by referral.game_id, referral.inviter_user_id
  ) as counted;

  perform private.reconcile_weekly_share_prize_pool(p_game_id, p_week_start, false, null);
end;
$$;

-- The public server-only generator delegates Share allocation to the complete
-- reconciler. Tournament awards remain unchanged.
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

revoke all on function private.weekly_share_prize_pool_cents() from public, anon, authenticated;
revoke all on function private.guard_weekly_share_prize_pool() from public, anon, authenticated;
revoke all on function private.reconcile_weekly_share_prize_pool(uuid, date, boolean, uuid) from public, anon, authenticated;
revoke all on function private.prevent_referral_relationship_change() from public, anon, authenticated;
revoke all on function private.guard_prize_balance_write() from public, anon, authenticated;
revoke all on function private.protect_provisional_winner() from public, anon, authenticated;
revoke all on function private.refresh_weekly_share_results(uuid, date) from public, anon, authenticated;
revoke all on function public.rtw_generate_provisional_winners(uuid, text, date) from public, anon, authenticated;

grant usage on schema private to service_role;
grant select, insert on table private.competition_award_generations to service_role;
grant insert, delete on table public.weekly_share_results to service_role;
grant insert, update on table public.prize_balances to service_role;
grant update (id) on table public.prize_ledger_entries to service_role;
grant execute on function private.refresh_weekly_share_results(uuid, date) to service_role;
grant execute on function private.reconcile_weekly_share_prize_pool(uuid, date, boolean, uuid) to service_role;
grant execute on function private.reverse_provisional_winner_credit(uuid, uuid) to service_role;
grant execute on function private.release_unsettled_payout_holds(uuid, uuid, uuid) to service_role;
grant execute on function private.flag_paid_winner_for_review(public.provisional_winners, uuid) to service_role;
grant execute on function public.rtw_generate_provisional_winners(uuid, text, date) to service_role;
