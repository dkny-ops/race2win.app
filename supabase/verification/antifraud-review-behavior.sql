-- Disposable PGlite-only fixtures. This file is never run against Supabase.
do $antifraud$
declare
  actor uuid := '11111111-1111-4111-8111-111111111111';
  game uuid;
  held_session uuid := gen_random_uuid();
  rejected_session uuid := gen_random_uuid();
  held_run uuid;
  rejected_run uuid;
  winner_id uuid;
begin
  select id into game from public.games where slug = 'race-to-win';
  insert into private.admin_users (user_id) values (actor) on conflict (user_id) do nothing;

  insert into public.game_sessions (id, user_id, game_id, gameplay_version, seed, started_at, expires_at)
  values (held_session, actor, game, 'rtw-v6', 9, now() - interval '3 minutes', now() + interval '7 minutes');
  perform public.rtw_finalize_game_session_with_checkpoints(
    held_session, actor, repeat('a', 64), 0, 777, 777000, 7777, 7777, false,
    'under_review', '["uniform_input_cadence","webdriver_reported","untrusted_input_events"]', '[]'
  );
  select id into held_run from public.validated_runs where game_session_id = held_session;
  if (select eligibility_status from public.validated_runs where id = held_run) <> 'under_review' then
    raise exception 'held run did not retain under_review status';
  end if;
  if exists (select 1 from public.daily_top_scores where validated_run_id = held_run) then
    raise exception 'held run entered daily Top 7';
  end if;
  if not exists (select 1 from public.fraud_reviews where subject_type = 'validated_run' and subject_id = held_run and status = 'under_review') then
    raise exception 'held run missing review record';
  end if;
  begin
    perform public.rtw_admin_set_validated_run_eligibility(actor, held_run, 'valid', 'bypass attempt');
    raise exception 'general admin function bypassed required review';
  exception when check_violation then null;
  end;
  begin
    update public.validated_runs set eligibility_status = 'valid' where id = held_run;
    raise exception 'direct server-principal update bypassed review';
  exception when insufficient_privilege then null;
  end;
  if public.rtw_admin_resolve_validated_run_antifraud_review(actor, held_run, 'approved', 'Reviewed locally') <> 'approved' then
    raise exception 'approval did not return canonical result';
  end if;
  if public.rtw_admin_resolve_validated_run_antifraud_review(actor, held_run, 'approved', 'retry') <> 'approved' then
    raise exception 'identical decision was not idempotent';
  end if;
  if (select eligibility_status from public.validated_runs where id = held_run) <> 'valid'
    or not exists (select 1 from public.daily_top_scores where validated_run_id = held_run) then
    raise exception 'approval did not restore score eligibility';
  end if;
  begin
    perform public.rtw_admin_resolve_validated_run_antifraud_review(actor, held_run, 'rejected', 'conflicting retry');
    raise exception 'conflicting final decision was accepted';
  exception when check_violation then null;
  end;

  insert into public.game_sessions (id, user_id, game_id, gameplay_version, seed, started_at, expires_at)
  values (rejected_session, actor, game, 'rtw-v6', 10, now() - interval '3 minutes', now() + interval '7 minutes');
  perform public.rtw_finalize_game_session_with_checkpoints(
    rejected_session, actor, repeat('b', 64), 0, 778, 778000, 7778, 7778, false,
    'under_review', '["uniform_input_cadence","webdriver_reported","untrusted_input_events"]', '[]'
  );
  select id into rejected_run from public.validated_runs where game_session_id = rejected_session;
  perform public.rtw_admin_resolve_validated_run_antifraud_review(actor, rejected_run, 'rejected', 'Rejected locally');
  if (select eligibility_status from public.validated_runs where id = rejected_run) <> 'fraud_confirmed'
    or (select assessment_status from private.game_session_antifraud_observations where game_session_id = rejected_session) <> 'rejected'
    or exists (select 1 from public.daily_top_scores where validated_run_id = rejected_run) then
    raise exception 'rejection did not preserve the required hold';
  end if;

  if exists (select 1 from public.prize_ledger_entries where player_id = actor)
    or exists (select 1 from public.payouts where player_id = actor) then
    raise exception 'anti-fraud review changed financial state';
  end if;
  begin
    perform public.rtw_admin_transition_winner(actor, gen_random_uuid(), 'paid', 'non-owner attempt');
    raise exception 'non-owner could record final payment';
  exception when insufficient_privilege then null;
  end;
  insert into public.provisional_winners (game_id, player_id, tournament_week_start, award_type, rank_position, amount_cents, claim_deadline_at, status)
  values (game, actor, current_date, 'weekly_tournament', 1, 25, now() + interval '1 day', 'approved_for_payment') returning id into winner_id;
  begin
    update public.provisional_winners set status = 'paid' where id = winner_id;
    raise exception 'direct server-principal payment update bypassed owner authorization';
  exception when insufficient_privilege then null;
  end;
  delete from public.provisional_winners where id = winner_id;
end $antifraud$;

set role anon;
do $browser$
begin
  begin
    select * from private.game_session_antifraud_observations;
    raise exception 'anon read private anti-fraud observations';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.rtw_admin_resolve_validated_run_antifraud_review(gen_random_uuid(), gen_random_uuid(), 'approved', 'browser');
    raise exception 'anon executed admin anti-fraud resolver';
  exception when insufficient_privilege then null;
  end;
end $browser$;
reset role;

set role authenticated;
do $browser$
begin
  begin
    select * from private.game_session_antifraud_observations;
    raise exception 'authenticated read private anti-fraud observations';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.rtw_admin_resolve_validated_run_antifraud_review(gen_random_uuid(), gen_random_uuid(), 'approved', 'browser');
    raise exception 'authenticated executed admin anti-fraud resolver';
  exception when insufficient_privilege then null;
  end;
end $browser$;
reset role;
