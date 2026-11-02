-- LOCAL reconstruction overlay from read-only live catalog; never apply to production.
-- Captures already-live behavior not represented in recorded migration statements.
CREATE OR REPLACE FUNCTION public.flappy_admin_allocate_prize(p_actor uuid, p_week date, p_player uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p private.flappy_prize_program%rowtype;
  c record;
  v_game uuid;
  v_amount integer;
  v_winner public.provisional_winners%rowtype;
begin
  if not exists(select 1 from private.admin_users where user_id=p_actor and is_active)
     or p_week is null or extract(isodow from p_week)<>1
     or p_player is null or p_note is null or length(btrim(p_note)) not between 1 and 500
  then raise exception 'Prize allocation unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flappy:prize:week:'||p_week::text,0));
  select * into p from private.flappy_prize_program where singleton and enabled for update;
  if not found or p_week<p.inaugural_week_start then raise exception 'Prize period unavailable'; end if;
  select * into c from private.flappy_prize_effective_candidates(p_week)
  where player_id=p_player and effective_rank between 1 and 3;
  if not found or c.state<>'approved' then raise exception 'Candidate approval unavailable'; end if;
  v_amount:=case c.effective_rank when 1 then 500 when 2 then 300 when 3 then 200 else null end;
  if v_amount is null then raise exception 'Prize allocation unavailable'; end if;
  select id into v_game from public.games where slug='flappy-race' and status='active';
  if v_game is null then raise exception 'Game unavailable'; end if;
  select * into v_winner from public.provisional_winners
  where game_id=v_game and tournament_week_start=p_week
    and award_type='weekly_tournament' and player_id=p_player
  for update;
  if not found then
    insert into public.provisional_winners(
      game_id,player_id,tournament_week_start,award_type,rank_position,amount_cents,
      allocation_status,status,claim_deadline_at,admin_note
    ) values (
      v_game,p_player,p_week,'weekly_tournament',c.effective_rank,v_amount,
      'allocated','provisional',clock_timestamp()+interval '90 days',
      'FlappyRace inaugural/weekly prize: '||left(btrim(p_note),420)
    ) returning * into v_winner;
  elsif v_winner.rank_position is distinct from c.effective_rank
     or v_winner.amount_cents is distinct from v_amount
     or v_winner.allocation_status<>'allocated' then
    raise exception 'Existing allocation conflict';
  end if;
  if v_winner.status='approved_for_payment' then
    return jsonb_build_object('winnerId',v_winner.id,'amountCents',v_amount,'idempotent',true,'paymentsEnabled',false);
  end if;
  if v_winner.status not in ('provisional','verified') then
    raise exception 'Existing award state unavailable';
  end if;
  if v_winner.status='provisional' then
    perform public.rtw_admin_transition_winner(p_actor,v_winner.id,'verified',
      'FlappyRace candidate approved after manual review.');
  end if;
  perform public.rtw_admin_transition_winner(p_actor,v_winner.id,'approved_for_payment',
    'FlappyRace financial credit approved by owner.');
  insert into private.flappy_prize_winner_case_events(week,player_id,actor,decision,note)
  values(p_week,p_player,p_actor,'financial_credit_approved',btrim(p_note));
  return jsonb_build_object('winnerId',v_winner.id,'amountCents',v_amount,'idempotent',false,'paymentsEnabled',false);
end;
$function$
;
revoke all on function public.flappy_admin_allocate_prize(p_actor uuid, p_week date, p_player uuid, p_note text) from public,anon,authenticated,service_role;
grant execute on function public.flappy_admin_allocate_prize(p_actor uuid, p_week date, p_player uuid, p_note text) to service_role;
CREATE OR REPLACE FUNCTION public.flappy_read_availability(p_player uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_now timestamptz := clock_timestamp(); v_used integer; v_next timestamptz; v_active timestamptz; v_exempt boolean;
begin
 if p_player is null or not exists(select 1 from private.flappy_control where enabled) then raise exception 'Availability unavailable'; end if;
 select exists(select 1 from public.rtw_hourly_limit_test_exemptions where player_id=p_player) into v_exempt;
 select count(*), min(created_at)+interval '1 hour' into v_used,v_next from private.flappy_sessions where player_id=p_player and created_at>v_now-interval '1 hour';
 select least(expires_at,lease_until) into v_active from private.flappy_sessions where player_id=p_player and status='active' and expires_at>=v_now and lease_until>=v_now;
 return jsonb_build_object('limit',5,'remaining',case when v_exempt then 5 else greatest(0,5-v_used) end,'exempt',v_exempt,'serverNow',v_now,'nextAvailableAt',case when v_exempt then null else v_next end,'activeUntil',v_active);
end $function$
;
revoke all on function public.flappy_read_availability(p_player uuid) from public,anon,authenticated,service_role;
grant execute on function public.flappy_read_availability(p_player uuid) to service_role;
CREATE OR REPLACE FUNCTION public.flappy_start(p_player uuid, p_seed bigint, p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s private.flappy_sessions%rowtype; v_game uuid; v_now timestamptz:=clock_timestamp();
begin
 if not exists(select 1 from private.flappy_control where enabled) then raise exception 'Disabled'; end if;
 perform pg_advisory_xact_lock(hashtextextended('flappy:player:'||p_player::text,0));
 if p_version is distinct from 'flappy-v1' or p_seed is null or p_seed<0 or p_seed>4294967295 then raise exception 'Invalid rules'; end if;
 if not exists(select 1 from auth.users where id=p_player and email_confirmed_at is not null) or not exists(select 1 from public.profiles where user_id=p_player and username is not null) then raise exception 'Player unavailable'; end if;
 select id into v_game from public.games where slug='flappy-race' and status='active';
 if v_game is null then raise exception 'Game unavailable'; end if;
 update private.flappy_sessions set status='expired' where player_id=p_player and status='active' and (expires_at<v_now or lease_until<v_now);
 if exists(select 1 from private.flappy_sessions where player_id=p_player and status='active') then raise exception 'Concurrent session'; end if;
 if not exists(select 1 from public.rtw_hourly_limit_test_exemptions where player_id=p_player)
 and (select count(*) from private.flappy_sessions where player_id=p_player and created_at>v_now-interval '1 hour')>=5 then raise exception 'Hourly limit'; end if;
 insert into private.flappy_sessions(player_id,game_id,version,seed,starts_at,expires_at,lease_until)
 values(p_player,v_game,p_version,p_seed,v_now+interval '3 seconds',v_now+interval '603 seconds',v_now+interval '18 seconds') returning * into s;
 return jsonb_build_object('sessionId',s.id,'seed',s.seed,'version',s.version,'startsAt',s.starts_at,'expiresAt',s.expires_at);
end $function$
;
revoke all on function public.flappy_start(p_player uuid, p_seed bigint, p_version text) from public,anon,authenticated,service_role;
grant execute on function public.flappy_start(p_player uuid, p_seed bigint, p_version text) to service_role;
CREATE OR REPLACE FUNCTION public.rtw_begin_balance_payout_request(p_player_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_balance bigint;
  v_eligible_cents bigint := 0;
  v_payout_id uuid;
  v_existing_payout_id uuid;
  v_credit record;
begin
  -- This serializes idempotent balance claims independently of the web tier
  -- and matches the correction path's lock order before credit-row locks.
  perform pg_advisory_xact_lock(hashtextextended('rtw:player-finance:' || p_player_id::text, 0));

  select available_cents into v_balance
  from public.prize_balances
  where player_id = p_player_id
  for update;
  if not found then
    raise exception 'Eligible prize balance is unavailable.' using errcode = '22023';
  end if;

  -- Repeated requests return the canonical active request. A duplicate click
  -- can therefore never create a second hold or payout.
  select id into v_existing_payout_id
  from public.payouts
  where player_id = p_player_id and status in ('requested', 'under_review', 'approved')
  for update;
  if found then return v_existing_payout_id; end if;

  -- Match the direct-prize eligibility rule at the database boundary; the
  -- browser cannot turn an aggregate ledger balance into a payable claim.
  if exists (
    select 1
    from public.player_eligibility_records as eligibility
    where eligibility.player_id = p_player_id
      and eligibility.prize_eligibility_status in ('restricted', 'ineligible')
  ) then
    raise exception 'Eligible prize balance is unavailable.' using errcode = '42501';
  end if;

  -- Only unallocated credits from approved, allocated provisional winners are
  -- payable. Manual adjustments, pending prizes, reversed credits, and any
  -- already-held credit are excluded even if they appear in the raw balance.
  for v_credit in
    select credit.id, credit.amount_cents
    from public.prize_ledger_entries as credit
    join public.provisional_winners as winner on winner.id = credit.provisional_winner_id
    where credit.player_id = p_player_id
      and credit.entry_type = 'credit'
      and winner.player_id = p_player_id
      and winner.status = 'approved_for_payment'
      and winner.allocation_status = 'allocated'
      and not exists (
        select 1 from public.prize_ledger_entries as reversal
        where reversal.reverses_ledger_entry_id = credit.id
      )
      and not exists (
        select 1 from public.payout_credit_allocations as allocation
        where allocation.credit_ledger_entry_id = credit.id
          and allocation.status in ('held', 'settled')
      )
    order by credit.created_at, credit.id
    for update of credit
  loop
    v_eligible_cents := v_eligible_cents + v_credit.amount_cents;
  end loop;

  if v_eligible_cents < 2000
    or v_balance < v_eligible_cents
    or v_eligible_cents > 2147483647 then
    raise exception 'Eligible prize balance is unavailable.' using errcode = '22023';
  end if;

  insert into public.payouts (player_id, amount_cents, status)
  values (p_player_id, v_eligible_cents::integer, 'requested')
  returning id into v_payout_id;

  insert into public.payout_credit_allocations (
    payout_id, credit_ledger_entry_id, amount_cents
  )
  select
    v_payout_id,
    credit.id,
    credit.amount_cents
  from public.prize_ledger_entries as credit
  join public.provisional_winners as winner on winner.id = credit.provisional_winner_id
  where credit.player_id = p_player_id
    and credit.entry_type = 'credit'
    and winner.player_id = p_player_id
    and winner.status = 'approved_for_payment'
    and winner.allocation_status = 'allocated'
    and not exists (
      select 1 from public.prize_ledger_entries as reversal
      where reversal.reverses_ledger_entry_id = credit.id
    )
    and not exists (
      select 1 from public.payout_credit_allocations as allocation
      where allocation.credit_ledger_entry_id = credit.id
        and allocation.status in ('held', 'settled')
    );

  insert into public.prize_ledger_entries (
    player_id, game_id, payout_id, entry_type, amount_cents, reason, created_by_user_id
  )
  select
    p_player_id,
    credit.game_id,
    v_payout_id,
    'payout_hold',
    -sum(allocation.amount_cents)::integer,
    'Player initiated eligible prize payout request',
    p_player_id
  from public.prize_ledger_entries as credit
  join public.payout_credit_allocations as allocation on allocation.credit_ledger_entry_id = credit.id
  where allocation.payout_id = v_payout_id
  group by credit.game_id;
  return v_payout_id;
end;
$function$
;
revoke all on function public.rtw_begin_balance_payout_request(p_player_id uuid) from public,anon,authenticated,service_role;
grant execute on function public.rtw_begin_balance_payout_request(p_player_id uuid) to service_role;
CREATE OR REPLACE FUNCTION public.rtw_expire_stale_game_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare changed integer; begin update public.game_sessions set status='expired' where status='active' and created_at <= now() - interval '1 hour'; get diagnostics changed = row_count; return changed; end; $function$
;
revoke all on function public.rtw_expire_stale_game_sessions() from public,anon,authenticated,service_role;
grant execute on function public.rtw_expire_stale_game_sessions() to service_role;
CREATE OR REPLACE FUNCTION public.rtw_generate_provisional_winners(p_actor_user_id uuid, p_game_slug text, p_week_start date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    case total.rank_position when 1 then 500 when 2 then 300 when 3 then 200 end,
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
$function$
;
revoke all on function public.rtw_generate_provisional_winners(p_actor_user_id uuid, p_game_slug text, p_week_start date) from public,anon,authenticated,service_role;
grant execute on function public.rtw_generate_provisional_winners(p_actor_user_id uuid, p_game_slug text, p_week_start date) to service_role;
CREATE OR REPLACE FUNCTION public.rtw_is_winner_contact_closed(p_winner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select exists(select 1 from private.winner_contact_closures where winner_id=p_winner) $function$
;
revoke all on function public.rtw_is_winner_contact_closed(p_winner uuid) from public,anon,authenticated,service_role;
grant execute on function public.rtw_is_winner_contact_closed(p_winner uuid) to service_role;
CREATE OR REPLACE FUNCTION public.rtw_owner_close_winner_contact(p_actor uuid, p_winner uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin if not exists(select 1 from private.admin_users where user_id=p_actor and is_active) then raise exception 'Unauthorized' using errcode='42501'; end if; if not exists(select 1 from public.provisional_winners where id=p_winner and award_type='weekly_tournament') then raise exception 'Winner unavailable'; end if; insert into private.winner_contact_closures(winner_id,closed_by) values(p_winner,p_actor) on conflict do nothing; insert into private.winner_owner_verifications(winner_id,paid_checked_at,paid_checked_by) values(p_winner,now(),p_actor) on conflict(winner_id) do update set paid_checked_at=coalesce(private.winner_owner_verifications.paid_checked_at,excluded.paid_checked_at),paid_checked_by=coalesce(private.winner_owner_verifications.paid_checked_by,excluded.paid_checked_by); return true; end $function$
;
revoke all on function public.rtw_owner_close_winner_contact(p_actor uuid, p_winner uuid) from public,anon,authenticated,service_role;
grant execute on function public.rtw_owner_close_winner_contact(p_actor uuid, p_winner uuid) to service_role;
CREATE OR REPLACE FUNCTION public.rtw_owner_confirm_full_balance_paid(p_actor uuid, p_player uuid, p_winner uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_balance bigint; v_sum bigint; v_game uuid; v_payout uuid; v_count integer;
begin
 if not exists(
   select 1 from private.admin_users a join auth.users u on u.id=a.user_id
   where a.user_id=p_actor and a.is_active and lower(u.email)='racetowinapp@gmail.com' and u.email_confirmed_at is not null
 ) then raise exception 'Owner only' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('rtw:player-finance:'||p_player::text,0));
 if not exists(select 1 from public.provisional_winners where id=p_winner and player_id=p_player and award_type='weekly_tournament' and allocation_status='allocated' and status='approved_for_payment') then raise exception 'Validated winner required' using errcode='22023'; end if;
 select available_cents into v_balance from public.prize_balances where player_id=p_player for update;
 if v_balance is null or v_balance < 2000 or v_balance > 2147483647 then raise exception 'Full eligible balance must be at least $20' using errcode='22023'; end if;
 if exists(select 1 from public.payouts where player_id=p_player and status in ('requested','under_review','approved')) then raise exception 'Active payout request exists' using errcode='22023'; end if;
 select coalesce(sum(credit.amount_cents),0),count(*),(array_agg(credit.game_id))[1] into v_sum,v_count,v_game
 from public.prize_ledger_entries credit join public.provisional_winners w on w.id=credit.provisional_winner_id
 where credit.player_id=p_player and credit.entry_type='credit' and w.player_id=p_player
 and w.status='approved_for_payment' and w.allocation_status='allocated'
 and not exists(select 1 from public.prize_ledger_entries rev where rev.reverses_ledger_entry_id=credit.id)
 and not exists(select 1 from public.payout_credit_allocations a where a.credit_ledger_entry_id=credit.id and a.status in ('held','settled'));
 if v_count=0 or v_sum<>v_balance then raise exception 'Balance and approved credits differ' using errcode='22023'; end if;
 insert into public.payouts(player_id,amount_cents,status,paid_at,approved_at)
 values(p_player,v_balance::integer,'paid',now(),now()) returning id into v_payout;
 insert into public.payout_credit_allocations(payout_id,credit_ledger_entry_id,amount_cents,status)
 select v_payout,credit.id,credit.amount_cents,'settled'
 from public.prize_ledger_entries credit join public.provisional_winners w on w.id=credit.provisional_winner_id
 where credit.player_id=p_player and credit.entry_type='credit' and w.player_id=p_player
 and w.status='approved_for_payment' and w.allocation_status='allocated'
 and not exists(select 1 from public.prize_ledger_entries rev where rev.reverses_ledger_entry_id=credit.id)
 and not exists(select 1 from public.payout_credit_allocations a where a.credit_ledger_entry_id=credit.id and a.status in ('held','settled'));
 insert into public.prize_ledger_entries(player_id,game_id,payout_id,entry_type,amount_cents,reason,created_by_user_id)
 values(p_player,v_game,v_payout,'payout_settlement',-v_balance::integer,'Owner confirmed full balance paid externally',p_actor);
 perform public.rtw_owner_close_winner_contact(p_actor,p_winner);
 return v_balance;
end $function$
;
revoke all on function public.rtw_owner_confirm_full_balance_paid(p_actor uuid, p_player uuid, p_winner uuid) from public,anon,authenticated,service_role;
grant execute on function public.rtw_owner_confirm_full_balance_paid(p_actor uuid, p_player uuid, p_winner uuid) to service_role;
CREATE OR REPLACE FUNCTION public.rtw_owner_verify_winner_email(p_actor uuid, p_winner uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin if not exists(select 1 from private.admin_users where user_id=p_actor and is_active) then raise exception 'Unauthorized' using errcode='42501'; end if; if not exists(select 1 from public.provisional_winners where id=p_winner and award_type='weekly_tournament') then raise exception 'Winner unavailable'; end if; insert into private.winner_owner_verifications(winner_id,email_checked_at,email_checked_by) values(p_winner,now(),p_actor) on conflict(winner_id) do update set email_checked_at=coalesce(private.winner_owner_verifications.email_checked_at,excluded.email_checked_at),email_checked_by=coalesce(private.winner_owner_verifications.email_checked_by,excluded.email_checked_by); return true; end $function$
;
revoke all on function public.rtw_owner_verify_winner_email(p_actor uuid, p_winner uuid) from public,anon,authenticated,service_role;
grant execute on function public.rtw_owner_verify_winner_email(p_actor uuid, p_winner uuid) to service_role;
CREATE OR REPLACE FUNCTION public.rtw_owner_winner_verification_status(p_winner uuid)
 RETURNS TABLE(email_checked_at timestamp with time zone, paid_checked_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select v.email_checked_at,v.paid_checked_at from private.winner_owner_verifications v where v.winner_id=p_winner $function$
;
revoke all on function public.rtw_owner_winner_verification_status(p_winner uuid) from public,anon,authenticated,service_role;
grant execute on function public.rtw_owner_winner_verification_status(p_winner uuid) to service_role;
CREATE OR REPLACE FUNCTION public.rtw_read_verified_protections(p_session_id uuid, p_player_id uuid)
 RETURNS TABLE(resume_simulation_ms integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
select h.resume_simulation_ms from private.rtw_human_check_history h
join public.game_sessions s on s.id=h.session_id and s.user_id=h.player_id
where h.session_id=p_session_id and h.player_id=p_player_id
and h.verified_at is not null and h.resume_simulation_ms is not null
order by h.resume_simulation_ms
$function$
;
revoke all on function public.rtw_read_verified_protections(p_session_id uuid, p_player_id uuid) from public,anon,authenticated,service_role;
grant execute on function public.rtw_read_verified_protections(p_session_id uuid, p_player_id uuid) to service_role;
CREATE OR REPLACE FUNCTION public.rtw_record_verified_protection(p_session_id uuid, p_player_id uuid, p_nonce uuid, p_resume_ms integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
if auth.role()<>'service_role' or p_resume_ms is null or p_resume_ms<0 or p_resume_ms>3600000 then return false; end if;
update private.rtw_human_check_history h set resume_simulation_ms=p_resume_ms,protection_applied_at=now()
where h.session_id=p_session_id and h.player_id=p_player_id and h.challenge_nonce=p_nonce
and h.verified_at is not null and h.resume_simulation_ms is null
and exists(select 1 from public.game_sessions s where s.id=p_session_id and s.user_id=p_player_id and s.status='active'
and p_resume_ms<=extract(epoch from (h.due_at-s.started_at))*1000+5000);
return found;
end $function$
;
revoke all on function public.rtw_record_verified_protection(p_session_id uuid, p_player_id uuid, p_nonce uuid, p_resume_ms integer) from public,anon,authenticated,service_role;
grant execute on function public.rtw_record_verified_protection(p_session_id uuid, p_player_id uuid, p_nonce uuid, p_resume_ms integer) to service_role;
update private.flappy_turnstile_control set enabled=true where singleton;

