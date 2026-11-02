-- Pending owner authorization for Production. No player/ledger/payout DML.
-- Fix the Flappy caller, not the shared winner state machine or prize rules.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('rtw:migration:flappy-prize-state-transition',0));

do $preflight$
declare f text;
begin
 select pg_get_functiondef('public.flappy_admin_allocate_prize(uuid,date,uuid,text)'::regprocedure) into f;
 if md5(regexp_replace(f,'[[:space:]]+',' ','g')) not in
   ('996ba05840edc830224ead1606ccc314','2ba119f3182b6f63f85b948c3685c8ce')
 then raise exception 'Unexpected Flappy allocation definition; review before applying'; end if;
 if md5(regexp_replace(pg_get_functiondef('private.protect_provisional_winner()'::regprocedure),'[[:space:]]+',' ','g'))
   <> '3723ef1f8de1c5c8f8f5e62eb011dbce'
 or md5(regexp_replace(pg_get_functiondef('public.rtw_admin_transition_winner(uuid,uuid,text,text)'::regprocedure),'[[:space:]]+',' ','g'))
   <> 'c73ae2c1b138c91f8c270600d7913b5d'
 then raise exception 'Shared winner state machine changed; stop'; end if;
 if (select proacl::text from pg_proc where oid='public.flappy_admin_allocate_prize(uuid,date,uuid,text)'::regprocedure)
   is distinct from '{postgres=X/postgres,service_role=X/postgres}'
 or has_function_privilege('anon','public.flappy_admin_allocate_prize(uuid,date,uuid,text)','EXECUTE')
 or has_function_privilege('authenticated','public.flappy_admin_allocate_prize(uuid,date,uuid,text)','EXECUTE')
 then raise exception 'Unexpected allocation privileges; stop'; end if;
end $preflight$;

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
    -- Candidate approval was checked above; follow the shared winner state machine.
    perform public.rtw_admin_transition_winner(p_actor,v_winner.id,'under_review',
      'FlappyRace approved candidate entered financial review.');
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

do $postflight$
begin
 if md5(regexp_replace(pg_get_functiondef('public.flappy_admin_allocate_prize(uuid,date,uuid,text)'::regprocedure),'[[:space:]]+',' ','g'))
   <> '2ba119f3182b6f63f85b948c3685c8ce'
 or (select proacl::text from pg_proc where oid='public.flappy_admin_allocate_prize(uuid,date,uuid,text)'::regprocedure)
   is distinct from '{postgres=X/postgres,service_role=X/postgres}'
 then raise exception 'Allocation definition or grants differ after replacement'; end if;
end $postflight$;

