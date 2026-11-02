begin;
set local statement_timeout='30s';
do $test$
declare
 actor uuid := '00000000-0000-4000-8000-000000000001';
 players uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 w date := date_trunc('week',current_date)::date-7;
 flappy uuid; race uuid; winner uuid; pay uuid; pay_again uuid;
 result jsonb; i integer; n integer; amount integer; failed boolean;
begin
 select id into strict flappy from public.games where slug='flappy-race';
 select id into strict race from public.games where slug='race-to-win';
 update private.flappy_prize_program set enabled=true,activated_at=now()-interval '30 days',inaugural_week_start=w-28 where singleton;
 for i in 1..3 loop
  insert into auth.users(id,email_confirmed_at) values(players[i],now());
  insert into public.profiles(user_id,username) values(players[i],'migtest'||i||substr(replace(players[i]::text,'-',''),1,8));
  insert into private.flappy_prize_period_results(week,player_id,username,weekly_total,scores,rank_position,review_required)
   select w,players[i],username,1000-i,array[1000-i],i,false from public.profiles where user_id=players[i];
 end loop;
 perform private.flappy_open_prize_cases(w);
 failed:=false;
 begin perform public.flappy_admin_allocate_prize(actor,w,players[1],'Pre-approval rejection test');
 exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Unreviewed credit was allowed'; end if;
 for i in 1..3 loop
  perform public.flappy_decide_prize_candidate(actor,w,players[i],'approved','Synthetic migration verification');
  -- Exercise the already-reviewed allocation branch without altering the live
  -- winner state machine. New-allocation behavior is checked separately below.
  insert into public.provisional_winners(game_id,player_id,tournament_week_start,award_type,rank_position,amount_cents,allocation_status,status,claim_deadline_at)
  values(flappy,players[i],w,'weekly_tournament',i,case i when 1 then 500 when 2 then 300 when 3 then 200 end,'allocated','verified',now()+interval '90 days');
  result:=public.flappy_admin_allocate_prize(actor,w,players[i],'Synthetic approved credit');
  amount:=case i when 1 then 500 when 2 then 300 when 3 then 200 end;
  if (result->>'amountCents')::integer<>amount then raise exception 'Incorrect rank % award',i; end if;
  perform public.flappy_admin_allocate_prize(actor,w,players[i],'Synthetic approved credit');
  if (select count(*) from public.prize_ledger_entries where player_id=players[i] and entry_type='credit')<>1
   or (select available_cents from public.prize_balances where player_id=players[i])<>amount
   then raise exception 'Duplicate or incorrect Flappy credit'; end if;
 end loop;
 failed:=false;
 begin perform public.rtw_begin_balance_payout_request(players[1]);
 exception when invalid_parameter_value then failed:=true; end;
 if not failed or exists(select 1 from public.payouts where player_id=players[1]) then raise exception 'Withdrawal below $20 allowed'; end if;
 for i in 1..3 loop
  insert into public.provisional_winners(game_id,player_id,tournament_week_start,award_type,rank_position,amount_cents,allocation_status,status,claim_deadline_at)
  values(race,players[1],w-i*7,'weekly_tournament',1,500,'allocated','provisional',now()+interval '90 days') returning id into winner;
  perform public.rtw_admin_transition_winner(actor,winner,'claim_started','Synthetic player claim');
  perform public.rtw_admin_transition_winner(actor,winner,'verified','Synthetic approved Race credit');
  perform public.rtw_admin_transition_winner(actor,winner,'approved_for_payment','Synthetic approved Race credit');
  perform public.rtw_admin_transition_winner(actor,winner,'approved_for_payment','Synthetic retry');
 end loop;
 if (select available_cents from public.prize_balances where player_id=players[1])<>2000 then raise exception 'Shared wallet aggregate differs'; end if;
 pay:=public.rtw_begin_balance_payout_request(players[1]);
 pay_again:=public.rtw_begin_balance_payout_request(players[1]);
 if pay is distinct from pay_again or (select count(*) from public.payouts where player_id=players[1])<>1
  or (select amount_cents from public.payouts where id=pay)<>2000
  or (select available_cents from public.prize_balances where player_id=players[1])<>0
 then raise exception 'Payout amount or idempotency differs'; end if;
 if (select count(distinct game_id) from public.prize_ledger_entries where player_id=players[1] and entry_type='credit')<>2 then raise exception 'Game isolation not exercised'; end if;
 if (select count(*) from public.payout_credit_allocations where payout_id=pay)<>4 then raise exception 'Credit allocated twice or missing'; end if;
 raise notice 'PASS: owner approval, 500/300/200, duplicate credit rejection, $20 guard, two-game wallet, payout retry idempotency';
end;
$test$;
do $access$
declare role_name text; sig text;
begin
 foreach role_name in array array['anon','authenticated'] loop
  foreach sig in array array['public.flappy_admin_allocate_prize(uuid,date,uuid,text)',
   'public.rtw_begin_balance_payout_request(uuid)','public.flappy_turnstile_verify(uuid,uuid,uuid)'] loop
   if has_function_privilege(role_name,sig,'EXECUTE') then raise exception 'Unexpected browser access: % %',role_name,sig; end if;
  end loop;
  if has_table_privilege(role_name,'public.prize_ledger_entries','INSERT,UPDATE,DELETE')
   or has_table_privilege(role_name,'public.prize_balances','INSERT,UPDATE,DELETE') then raise exception 'Browser financial table write'; end if;
 end loop;
 raise notice 'PASS: browser financial and Turnstile RPC privileges denied';
end;
$access$;
select 'PASS financial fixtures, two-game wallet, retries and denied browser privileges' as verification;
rollback;
