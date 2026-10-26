\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111','one@test.invalid',now()),
 ('22222222-2222-4222-8222-222222222222','two@test.invalid',now()),
 ('33333333-3333-4333-8333-333333333333','three@test.invalid',now()),
 ('44444444-4444-4444-8444-444444444444','four@test.invalid',now()),
 ('55555555-5555-4555-8555-555555555555','five@test.invalid',null);
insert into public.profiles(user_id,username,paypal_email) values
 ('11111111-1111-4111-8111-111111111111','Alpha','shared@test.invalid'),
 ('22222222-2222-4222-8222-222222222222','Beta','shared@test.invalid'),
 ('33333333-3333-4333-8333-333333333333','Gamma',null),
 ('44444444-4444-4444-8444-444444444444','Delta',null);
do $$ declare result jsonb; begin
 if public.rtw_record_competition_access('55555555-5555-4555-8555-555555555555','race-to-win',null)<>'verified_email_required' then raise exception 'Unverified email accepted'; end if;
 if public.rtw_record_competition_access('11111111-1111-4111-8111-111111111111','race-to-win',repeat('a',64))<>'allowed' then raise exception 'Verified identity denied'; end if;
 if public.rtw_record_competition_access('22222222-2222-4222-8222-222222222222','flappy-race',repeat('a',64))<>'allowed' then raise exception 'Shared network blocked'; end if;
 perform public.rtw_record_competition_access('11111111-1111-4111-8111-111111111111','race-to-win',repeat('a',64));
 if (select count(*) from private.competition_network_evidence where player_id='11111111-1111-4111-8111-111111111111')<>1 then raise exception 'Evidence duplicated'; end if;
 result:=public.rtw_admin_identity_evidence('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',date_trunc('week',now())::date);
 if jsonb_array_length(result->'relatedAccounts')<>2 then raise exception 'Relationships missing: %',result; end if;
 if result::text like '%shared@test.invalid%' or result::text like '%'||repeat('a',64)||'%' then raise exception 'Private evidence leaked'; end if;
 begin perform public.rtw_admin_identity_evidence('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2026-10-19'); raise exception 'Nonadmin accepted'; exception when insufficient_privilege then null; end;
end $$;
update auth.users set email=' ONE@test.invalid ' where id='22222222-2222-4222-8222-222222222222';
do $$ begin
 if public.rtw_record_competition_access('22222222-2222-4222-8222-222222222222','flappy-race',null)<>'identity_conflict' then raise exception 'Duplicate identity accepted'; end if;
 if not exists(select 1 from public.fraud_flags where player_id='22222222-2222-4222-8222-222222222222' and signal_data->>'code'='verified_email_conflict') then raise exception 'No conflict evidence'; end if;
end $$;
update auth.users set email='two@test.invalid' where id='22222222-2222-4222-8222-222222222222';
-- Real official start RPCs still enforce verified identity at the DB boundary.
select public.rtw_start_official_game_session_v3('11111111-1111-4111-8111-111111111111','race-to-win','rtw-v7',42);
select public.flappy_start('22222222-2222-4222-8222-222222222222',42,'flappy-v1');
do $$ begin
 begin perform public.rtw_start_official_game_session_v3('55555555-5555-4555-8555-555555555555','race-to-win','rtw-v7',42); raise exception 'Unverified RTW start accepted'; exception when insufficient_privilege then null; end;
 begin perform public.flappy_start('55555555-5555-4555-8555-555555555555',42,'flappy-v1'); raise exception 'Unverified Flappy start accepted'; exception when insufficient_privilege then null; when raise_exception then if sqlerrm<>'Player unavailable' then raise; end if; end;
end $$;

insert into private.competition_network_evidence(player_id,game_slug,day,network_hmac,first_seen,last_seen)
 values('33333333-3333-4333-8333-333333333333','race-to-win',current_date-31,repeat('b',64),now()-interval '31 days',now()-interval '31 days');
select private.prune_competition_network_evidence();
do $$ begin if exists(select 1 from private.competition_network_evidence where first_seen<now()-interval '30 days') then raise exception 'Retention failed'; end if; end $$;
insert into public.weekly_tournament_totals(game_id,player_id,tournament_week_start,weekly_total_score,individual_scores,rank_position,tie_break_status)
 select g.id,u.id,'2026-10-19',1000-n*100,array[1000-n*100],n,'resolved'
 from public.games g cross join (values('11111111-1111-4111-8111-111111111111'::uuid,1),('22222222-2222-4222-8222-222222222222'::uuid,2),('33333333-3333-4333-8333-333333333333'::uuid,3),('44444444-4444-4444-8444-444444444444'::uuid,4)) u(id,n) where g.slug='race-to-win';
select private.rtw_prepare_previous_week_candidates();
select public.rtw_admin_reject_winner_candidate('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-19','11111111-1111-4111-8111-111111111111','Isolated review fixture');
select public.rtw_admin_reject_winner_candidate('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-19','11111111-1111-4111-8111-111111111111','Idempotent repeat');
do $$ declare result jsonb; begin
 result:=public.rtw_admin_read_winner_candidates('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-19');
 if jsonb_array_length(result)<>3 then raise exception 'Candidate count wrong: %',result; end if;
 if not exists(select 1 from jsonb_array_elements(result) c where c->>'player_id'='44444444-4444-4444-8444-444444444444' and c->>'rank_position'='1') then raise exception 'Substitute missing: %',result; end if;
 if not exists(select 1 from jsonb_array_elements(result) c where c->>'player_id'='22222222-2222-4222-8222-222222222222' and c->>'rank_position'='2') then raise exception 'Other position changed'; end if;
 if (select count(*) from private.rtw_winner_case_events)<>1 then raise exception 'Decision not idempotent'; end if;
 if exists(select 1 from public.prize_ledger_entries) or exists(select 1 from public.payouts) then raise exception 'Automatic financial write'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('rtw_record_competition_access','rtw_admin_identity_evidence','rtw_admin_read_winner_candidates','rtw_admin_reject_winner_candidate') and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) then raise exception 'Browser execute permitted'; end if;
end $$;
-- Exercise the unchanged Flappy top-seven and automatic weekly candidate flow
-- with isolated, privileged fixtures; no browser score writer is used.
do $$ declare player uuid; amount int; game uuid; sid uuid; result jsonb; begin
 select id into game from public.games where slug='flappy-race';
 for player,amount in select * from (values
 ('11111111-1111-4111-8111-111111111111'::uuid,1),('11111111-1111-4111-8111-111111111111'::uuid,2),
 ('11111111-1111-4111-8111-111111111111'::uuid,3),('11111111-1111-4111-8111-111111111111'::uuid,4),
 ('11111111-1111-4111-8111-111111111111'::uuid,5),('11111111-1111-4111-8111-111111111111'::uuid,6),
 ('11111111-1111-4111-8111-111111111111'::uuid,7),('11111111-1111-4111-8111-111111111111'::uuid,8),
 ('22222222-2222-4222-8222-222222222222'::uuid,100),('33333333-3333-4333-8333-333333333333'::uuid,90),
 ('44444444-4444-4444-8444-444444444444'::uuid,80)) fixtures(player,amount)
 loop
 insert into private.flappy_sessions(player_id,game_id,version,seed,status,starts_at,expires_at,lease_until,outcome)
 values(player,game,'flappy-v1',42,'finalized',now(),now()+interval '10 minutes',now(),'{"verification":"replay_verified"}') returning id into sid;
 insert into private.flappy_runs(session_id,player_id,game_id,score,collision_tick,completed_at,tournament_day,tournament_week_start,eligibility,review_actor,reviewed_at,review_note)
 values(sid,player,game,amount,40,'2026-10-19','2026-10-19','2026-10-19','valid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),'Isolated fixture');
 end loop;
 result:=public.flappy_read_ranking('2026-10-19',1);
 if not exists(select 1 from jsonb_array_elements(result->'entries') e where e->>'username'='Alpha' and (e->>'weeklyTotal')::int=35) then raise exception 'Daily top-seven changed: %',result; end if;
 perform public.flappy_close_week('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-19');
 perform public.flappy_decide_winner_candidate('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-19','22222222-2222-4222-8222-222222222222','rejected','Isolated rejection');
 result:=public.flappy_admin_read_winner_cases('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-19');
 if (select count(*) from jsonb_array_elements(result->'candidates') c where (c->>'effectiveRank')::int between 1 and 3)<>3 then raise exception 'Flappy candidate count changed'; end if;
 if not exists(select 1 from jsonb_array_elements(result->'candidates') c where c->>'username'='Alpha' and (c->>'effectiveRank')::int=3) then raise exception 'Flappy substitute missing'; end if;
 if exists(select 1 from public.prize_ledger_entries) or exists(select 1 from public.payouts) or exists(select 1 from private.flappy_reward_reservations) then raise exception 'Automatic financial/reward effect'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform 1 from private.competition_network_evidence; raise exception 'Private table readable'; exception when insufficient_privilege then null; end;
 begin perform public.rtw_record_competition_access('11111111-1111-4111-8111-111111111111','race-to-win',null); raise exception 'Browser access spoof'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: identity, shared network, privacy, retention, candidates, idempotence, no payments, browser grants';
