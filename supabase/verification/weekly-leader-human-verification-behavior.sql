-- Disposable PGlite-only checks for the post-finalization leadership CAPTCHA.
-- No token is stored or simulated here; the provider is validated by the HTTP
-- route before the scoped server-only resolver may run.
do $leader_check$
declare
  leader uuid := '33333333-3333-4333-8333-333333333333';
  rival uuid := '44444444-4444-4444-8444-444444444444';
  game uuid;
  session_one uuid := gen_random_uuid();
  session_two uuid := gen_random_uuid();
  rival_session uuid := gen_random_uuid();
  run_one uuid;
  run_two uuid;
  week_start date := private.ny_tournament_week_start(now());
begin
  select id into game from public.games where slug = 'race-to-win';
  insert into auth.users (id) values (leader), (rival) on conflict do nothing;
  insert into public.profiles (user_id, username) values (leader, 'LeaderFixture'), (rival, 'RivalFixture') on conflict do nothing;

  insert into public.game_sessions (id, user_id, game_id, gameplay_version, seed, started_at, expires_at, checkpoint_interval_score, activity_lease_expires_at)
  values (session_one, leader, game, 'rtw-v7', 71, now() - interval '3 minutes', now() + interval '5 minutes', 1000, now() + interval '5 minutes');
  perform public.rtw_finalize_game_session_with_checkpoints(session_one, leader, repeat('c',64), 0, 1000000, 1000000000, 1000, 1000, false, 'verified', '[]', '[]');
  select id into run_one from public.validated_runs where game_session_id = session_one;
  if (select eligibility_status from public.validated_runs where id = run_one) <> 'under_review'
    or exists (select 1 from public.daily_top_scores where validated_run_id = run_one)
    or not exists (select 1 from private.weekly_leader_human_verifications where validated_run_id = run_one and reason = 'weekly_leadership' and status = 'pending') then
    raise exception 'new unique leader was not held for verification';
  end if;
  -- The finalizer's transaction-local guard is gone before a later REST/DML
  -- request. Clear it in this single-block fixture to model that boundary.
  perform set_config('app.rtw_weekly_leader_human_verification', '', true);
  begin
    update public.validated_runs set eligibility_status = 'valid' where id = run_one;
    raise exception 'direct DML cleared leadership hold';
  exception when insufficient_privilege then null;
  end;
  perform public.rtw_verify_weekly_leader_human_verification(session_one, leader);
  perform public.rtw_verify_weekly_leader_human_verification(session_one, leader);
  if (select eligibility_status from public.validated_runs where id = run_one) <> 'valid'
    or not exists (select 1 from public.daily_top_scores where validated_run_id = run_one) then
    raise exception 'scoped verification was not idempotent or did not restore eligibility: status %, challenge %, top7 %',
      (select eligibility_status from public.validated_runs where id = run_one),
      (select status from private.weekly_leader_human_verifications where validated_run_id = run_one),
      exists (select 1 from public.daily_top_scores where validated_run_id = run_one);
  end if;

  -- An eligible legacy run can replace the leader; it neither gets a new
  -- CAPTCHA nor changes the historical v6 semantics, but it records loss.
  insert into public.game_sessions (id, user_id, game_id, gameplay_version, seed, started_at, expires_at)
  values (rival_session, rival, game, 'rtw-v6', 72, now() - interval '3 minutes', now() + interval '5 minutes');
  update public.game_sessions set status = 'finalized', finalized_at = now(), input_digest = repeat('d',64), input_count = 0,
    final_score = 2000000, final_distance_millimeters = 2000000000, final_elapsed_ms = 1000, final_collision_at_ms = 1000
  where id = rival_session;
  if (select leader_player_id from private.weekly_leadership_state where game_id = game and tournament_week_start = week_start) <> rival then
    raise exception 'leader loss was not recorded';
  end if;

  insert into public.game_sessions (id, user_id, game_id, gameplay_version, seed, started_at, expires_at, checkpoint_interval_score, activity_lease_expires_at)
  values (session_two, leader, game, 'rtw-v7', 73, now() - interval '3 minutes', now() + interval '5 minutes', 1000, now() + interval '5 minutes');
  perform public.rtw_finalize_game_session_with_checkpoints(session_two, leader, repeat('e',64), 0, 3000000, 3000000000, 1000, 1000, false, 'verified', '[]', '[]');
  select id into run_two from public.validated_runs where game_session_id = session_two;
  if (select eligibility_status from public.validated_runs where id = run_two) <> 'under_review'
    or not exists (select 1 from private.weekly_leader_human_verifications where validated_run_id = run_two and reason = 'weekly_leadership' and status = 'pending') then
    raise exception 'leadership reclaim did not require a new verification';
  end if;
  if exists (select 1 from public.prize_ledger_entries where player_id in (leader, rival))
    or exists (select 1 from public.payouts where player_id in (leader, rival)) then
    raise exception 'human-verification gate changed financial state';
  end if;
end $leader_check$;

set role anon;
do $browser$
begin
  begin
    select * from private.weekly_leader_human_verifications;
    raise exception 'anon read verification records';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.rtw_verify_weekly_leader_human_verification(gen_random_uuid(), gen_random_uuid());
    raise exception 'anon executed scoped verification resolver';
  exception when insufficient_privilege then null;
  end;
end $browser$;
reset role;
