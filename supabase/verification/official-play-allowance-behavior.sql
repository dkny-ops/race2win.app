-- PGlite-only proof of the play allowance contract. The synthetic credit row
-- models a reward already verified by a future provider SSV adapter; this file
-- never models a browser claiming to have watched an advertisement.
do $allowance$
declare
  player uuid := '66666666-6666-4666-8666-666666666666';
  game uuid; hour_start timestamptz := private.official_play_hour_start(now());
  one record; retry record; sixth_failed boolean := false; rewarded record;
begin
  insert into auth.users (id) values (player) on conflict do nothing;
  select id into game from public.games where slug = 'race-to-win';

  select * into one from public.rtw_start_official_game_session_v4(player,'race-to-win','rtw-v7',101,'10000000-0000-4000-8000-000000000001');
  select * into retry from public.rtw_start_official_game_session_v4(player,'race-to-win','rtw-v7',999,'10000000-0000-4000-8000-000000000001');
  if one.id <> retry.id or one.seed <> retry.seed or (select free_plays_consumed from private.official_play_allowance_windows where player_id=player and game_id=game and hour_started_at=hour_start) <> 1 then
    raise exception 'idempotent start did not return exactly one allowance/session';
  end if;
  perform * from public.rtw_start_official_game_session_v4(player,'race-to-win','rtw-v7',102,'10000000-0000-4000-8000-000000000002');
  perform * from public.rtw_start_official_game_session_v4(player,'race-to-win','rtw-v7',103,'10000000-0000-4000-8000-000000000003');
  perform * from public.rtw_start_official_game_session_v4(player,'race-to-win','rtw-v7',104,'10000000-0000-4000-8000-000000000004');
  perform * from public.rtw_start_official_game_session_v4(player,'race-to-win','rtw-v7',105,'10000000-0000-4000-8000-000000000005');
  begin
    perform * from public.rtw_start_official_game_session_v4(player,'race-to-win','rtw-v7',106,'10000000-0000-4000-8000-000000000006');
  exception when raise_exception then
    if sqlerrm = 'No official plays remain for this New York hour.' then sixth_failed := true; else raise; end if;
  end;
  if not sixth_failed then raise exception 'sixth free start was accepted'; end if;

  -- Only a server-side verified event can create this row. It expires in the
  -- same authoritative hour and is consumed once by the next start.
  insert into private.verified_rewarded_play_credits(player_id,game_id,hour_started_at,provider_event_id,provider_name)
    values(player,game,hour_start,'fixture-provider-event-0001','fixture') returning id into rewarded;
  select * into rewarded from public.rtw_start_official_game_session_v4(player,'race-to-win','rtw-v7',107,'10000000-0000-4000-8000-000000000007');
  if rewarded.allowance_source <> 'rewarded' or exists(select 1 from private.verified_rewarded_play_credits where player_id=player and status='issued') then
    raise exception 'verified rewarded credit was not atomically consumed';
  end if;
  if private.official_play_hour_start('2026-11-01 05:30:00+00') = private.official_play_hour_start('2026-11-01 06:30:00+00') then
    raise exception 'DST fall-back merged two real New York hours';
  end if;
  if exists (select 1 from public.prize_ledger_entries where player_id=player) or exists (select 1 from public.prize_balances where player_id=player) then
    raise exception 'play allowance touched financial records';
  end if;
end $allowance$;

set role anon;
do $browser$
begin
  begin select * from private.official_play_allowance_windows; raise exception 'anon read allowance'; exception when insufficient_privilege then null; end;
  begin perform public.rtw_start_official_game_session_v4(gen_random_uuid(),'race-to-win','rtw-v7',1,gen_random_uuid()); raise exception 'anon started session'; exception when insufficient_privilege then null; end;
end $browser$;
reset role;
