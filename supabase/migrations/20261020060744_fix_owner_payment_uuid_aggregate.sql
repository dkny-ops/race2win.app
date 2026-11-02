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
 if v_balance is null or v_balance < 1000 or v_balance > 2147483647 then raise exception 'Full eligible balance must be at least $10' using errcode='22023'; end if;
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
