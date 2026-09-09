begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
do $test$
declare
 a uuid := gen_random_uuid();
 b uuid := gen_random_uuid();
 actor uuid := gen_random_uuid();
 inviter uuid := gen_random_uuid();
 g uuid; w uuid; p uuid; p2 uuid; refid uuid; sid uuid; runid uuid;
 code text; d date; t timestamptz; i integer; j integer;
 week1 date := private.week_start_for_date(current_date)+7;
 week2 date := private.week_start_for_date(current_date)+14;
 awardweek date := private.week_start_for_date(current_date)-7;
 results jsonb := '[]'::jsonb;
begin
 insert into auth.users(id,email_confirmed_at) values(a,now()),(b,now()),(actor,now()),(inviter,now());
 insert into public.games(slug,display_name) values ('rtw-integration-'||replace(gen_random_uuid()::text,'-',''),'Disposable transactional TEST') returning id into g;
 insert into private.admin_users(user_id) values(actor) on conflict do nothing;
 insert into public.weekly_share_results(game_id,tournament_week_start,player_id,confirmed_share_count,rank_position,is_winner) values(g,awardweek,a,1,1,true);
 perform private.reconcile_weekly_share_prize_pool(g,awardweek,true,actor);
 select id into strict w from public.provisional_winners where game_id=g and player_id=a and award_type='weekly_shares';
 if (select amount_cents from public.provisional_winners where id=w)<>1000 then raise exception 'F01 initial pool'; end if;
 if public.rtw_begin_prize_claim(b,w) then raise exception 'Wrong owner claim'; end if;
 if not public.rtw_begin_prize_claim(a,w) or not public.rtw_begin_prize_claim(a,w) then raise exception 'Valid idempotent claim'; end if;
 perform public.rtw_admin_transition_winner(actor,w,'verified');
 perform public.rtw_admin_transition_winner(actor,w,'approved_for_payment');
 perform public.rtw_admin_transition_winner(actor,w,'approved_for_payment');
 if (select count(*) from public.prize_ledger_entries where provisional_winner_id=w and entry_type='credit')<>1 then raise exception 'Duplicate credit'; end if;
 p := public.rtw_begin_balance_payout_request(a);
 p2 := public.rtw_begin_balance_payout_request(a);
 if p is distinct from p2 or (select available_cents from public.prize_balances where player_id=a)<>0 then raise exception 'Payout debit/idempotency'; end if;
 if (select amount_cents from public.payouts where id=p)<>1000 then raise exception 'Server payout amount'; end if;
 begin update public.prize_ledger_entries set id=id where provisional_winner_id=w; raise exception 'Ledger UPDATE bypass' using errcode='P9999'; exception when check_violation or insufficient_privilege then null; end;
 begin delete from public.prize_ledger_entries where provisional_winner_id=w; raise exception 'Ledger DELETE bypass' using errcode='P9999'; exception when check_violation or insufficient_privilege then null; end;
 insert into public.weekly_share_results(game_id,tournament_week_start,player_id,confirmed_share_count,rank_position,is_winner) values(g,awardweek,b,1,1,true);
 perform private.reconcile_weekly_share_prize_pool(g,awardweek,true,actor);
 perform private.reconcile_weekly_share_prize_pool(g,awardweek,true,actor);
 if (select sum(amount_cents) from public.provisional_winners where game_id=g and award_type='weekly_shares' and allocation_status='allocated' and status not in('disqualified','expired'))<>1000 then raise exception 'F01 pool exceeded'; end if;
 if (select count(*) from public.provisional_winners where game_id=g and allocation_status='allocated')<>2 then raise exception 'F01 canonical count'; end if;
 if (select count(*) from public.prize_ledger_entries where provisional_winner_id=w and entry_type='credit_reversal')<>1 then raise exception 'Credit reversal idempotency'; end if;
 if (select status from public.payouts where id=p) <> 'cancelled' then raise exception 'Hold not cancelled'; end if;
 if (select available_cents from public.prize_balances where player_id=a)<>0 then raise exception 'Reversal balance'; end if;
 begin
 insert into public.provisional_winners(game_id,player_id,tournament_week_start,award_type,rank_position,amount_cents,claim_deadline_at)
 values(g,inviter,awardweek,'weekly_shares',1,1001,now()+interval '1 day');
 raise exception 'Pool guard bypass' using errcode='P9999';
 exception when check_violation or insufficient_privilege then null; end;
 delete from public.weekly_share_results where game_id=g;
 perform private.reconcile_weekly_share_prize_pool(g,awardweek,true,actor);
 if exists(select 1 from public.provisional_winners where game_id=g and allocation_status='allocated') then raise exception 'Zero winner regression'; end if;
 results:=results||jsonb_build_array('PASS F01 one-to-two split stays 1000; retries stable; zero-winner reconciliation; cap guard','PASS claim ownership, one credit, payout idempotency and server amount','PASS C debit, immutable ledger, release, single reversal and final balance');
 code := public.rtw_ensure_referral_code(inviter,(select slug from public.games where id=g));
 refid := public.rtw_attach_referral(b,(select slug from public.games where id=g),code);
 -- Trusted calendar fixtures exercise the installed triggers. These are not browser-supplied dates.
 for i in 0..9 loop
   d := case when i<5 then week1-28+i when i<8 then week1+i-5 else week2+i-8 end;
   for j in 1..3 loop
     t:=(d::timestamp at time zone 'America/New_York') + interval '12 hours';
     sid:=gen_random_uuid();
     insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at)
     values(sid,b,g,'rtw-v6',1,t,t+interval '10 minutes');
     update public.game_sessions set status='finalized',finalized_at=t+interval '1 second',input_digest=repeat('a',64),input_count=0,final_score=10,final_distance_millimeters=100000,final_elapsed_ms=1000,final_collision_at_ms=1000 where id=sid;
   end loop;
   if i=4 and (select qualified_day_count from public.referrals where id=refid)<>0 then raise exception 'Referral cutoff bypass'; end if;
 end loop;
 if (select status from public.referrals where id=refid)<>'invite_pending' or (select qualified_day_count from public.referrals where id=refid)<>3 then raise exception 'B cross-week accumulation'; end if;
 for i in 2..4 loop
   d:=week2+i;
   for j in 1..3 loop
     t:=(d::timestamp at time zone 'America/New_York')+interval '12 hours';
     sid:=gen_random_uuid();
     insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at) values(sid,b,g,'rtw-v6',1,t,t+interval '10 minutes');
     update public.game_sessions set status='finalized',finalized_at=t+interval '1 second',input_digest=repeat('a',64),input_count=0,final_score=10,final_distance_millimeters=100000,final_elapsed_ms=1000,final_collision_at_ms=1000 where id=sid;
   end loop;
 end loop;
 if (select status from public.referrals where id=refid)<>'valid' or (select confirmed_tournament_week_start from public.referrals where id=refid)<>week2 then raise exception 'Same week qualification'; end if;
 begin update public.referrals set confirmed_tournament_week_start=week1 where id=refid; raise exception 'Share week bypass' using errcode='P9999'; exception when check_violation or insufficient_privilege then null; end;
 begin update public.referrals set confirmed_at=now()+interval '1 day' where id=refid; raise exception 'Share date bypass' using errcode='P9999'; exception when check_violation or insufficient_privilege then null; end;
 select id into strict runid from public.validated_runs where game_session_id=sid;
 perform public.rtw_admin_set_validated_run_eligibility(actor,runid,'disqualified','Disposable TEST');
 if (select status from public.referrals where id=refid)<>'under_review' or (select confirmed_tournament_week_start from public.referrals where id=refid)<>week2 then raise exception 'Retroactive Share correction'; end if;
 if (select count(*) from public.weekly_share_results where game_id=g and player_id=inviter)<>0 then raise exception 'Disqualified Share still ranked'; end if;
 results:=results||jsonb_build_array('PASS B separate weeks 3+2 remain pending; one week 5 qualifies','PASS referral cutoff and confirmed week/date immutability','PASS retroactive disqualification removes Share and preserves original week');
 perform public.rtw_generate_provisional_winners(actor,(select slug from public.games where id=g),week1-28);
 perform public.rtw_generate_provisional_winners(actor,(select slug from public.games where id=g),week1-28);
 if (select count(*) from public.provisional_winners where game_id=g and tournament_week_start=week1-28 and award_type='weekly_tournament')<>1 then raise exception 'Generator duplicate award'; end if;
 perform set_config('rtw.integration_result',results::text,true);
end;
$test$;
select current_setting('rtw.integration_result')::jsonb as results;
-- Least-privilege runtime control: use a fresh synthetic identity and exercise
-- the same service_role table update used by the HTTP finalize route.
do $control$
declare u uuid := gen_random_uuid(); s uuid := gen_random_uuid(); g uuid;
begin
 insert into auth.users(id,email_confirmed_at) values(u,now());
 select id into strict g from public.games where slug='race-to-win';
 perform set_config('rtw.probe_user',u::text,true);
 perform set_config('rtw.probe_session',s::text,true);
 insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at)
 values(s,u,g,'rtw-v6',1,now(),now()+interval '5 minutes');
end;
$control$;
set local role service_role;
select private.refresh_weekly_share_results((select id from public.games where slug='race-to-win'),'2000-01-03');
update public.game_sessions set status='finalized',finalized_at=now(),input_digest=repeat('a',64),input_count=0,final_score=10,final_distance_millimeters=1000,final_elapsed_ms=1000,final_collision_at_ms=1000
where id=current_setting('rtw.probe_session')::uuid;
do $checks$
begin
 perform set_config('app.rtw_ledger_write','off',true);
 if not exists(select 1 from public.validated_runs where game_session_id=current_setting('rtw.probe_session')::uuid) then raise exception 'Finalize did not derive a run'; end if;
 begin truncate public.prize_ledger_entries cascade; raise exception 'Ledger TRUNCATE bypass' using errcode='P9999'; exception when insufficient_privilege then null; end;
 begin insert into public.prize_balances(player_id,available_cents) values(current_setting('rtw.probe_user')::uuid,1); raise exception 'Balance guard bypass' using errcode='P9999'; exception when check_violation or insufficient_privilege then null; end;
end;
$checks$;
reset role;
select 'PASS service_role finalize and derived triggers; TRUNCATE denied; balance guard fails closed' as result;
do $profile_setup$
declare u uuid := gen_random_uuid(); s uuid := gen_random_uuid();
begin
 insert into auth.users(id,email_confirmed_at) values(u,now());
 insert into auth.sessions(id,user_id) values(s,u);
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',s,'role','authenticated')::text,true);
end $profile_setup$;
set local role authenticated;
insert into public.profiles(user_id,paypal_email) values(auth.uid(),'isolated@example.com');
do $active$ begin if (select count(*) from public.profiles)<>1 then raise exception 'Active profile denied'; end if; end $active$;
reset role;
delete from auth.sessions where id=(auth.jwt()->>'session_id')::uuid;
set local role authenticated;
do $revoked$ declare n integer; begin
 update public.profiles set paypal_email='revoked@example.com' where user_id=auth.uid();
 get diagnostics n=row_count;
 if n<>0 or (select count(*) from public.profiles)<>0 then raise exception 'Revoked profile bypass'; end if;
end $revoked$;
reset role;
do $security$ begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'rtw_%' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) then raise exception 'Browser executable RPC'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef and (n.nspname='private' or p.proname like 'rtw_%') and not ('search_path=""'=any(p.proconfig))) then raise exception 'Unsafe definer search_path'; end if;
end $security$;
select 'PASS live profile session policy, revoked profile denied, generator and browser EXECUTE/search_path' as result;
rollback;
