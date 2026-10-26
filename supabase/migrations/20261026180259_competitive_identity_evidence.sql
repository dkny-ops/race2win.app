-- Additive evidence only. No score, quota, prize or payment policy changes.
set lock_timeout='5s';
set statement_timeout='30s';
select pg_advisory_xact_lock(hashtextextended('competitive_identity_evidence_v1',0));

-- No existing observation table represents network relationships across both games.
-- Daily rotating server HMACs, no raw IP, fingerprint, cookie or device ID.
create table private.competition_network_evidence (
  player_id uuid not null references auth.users(id) on delete cascade,
  game_slug text not null check(game_slug in ('race-to-win','flappy-race')),
  day date not null,
  network_hmac text not null check(network_hmac ~ '^[0-9a-f]{64}$'),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key(player_id,game_slug,day,network_hmac)
);
create index competition_network_evidence_link on private.competition_network_evidence(day,network_hmac,player_id);
alter table private.competition_network_evidence enable row level security;
revoke all on private.competition_network_evidence from public,anon,authenticated,service_role;

create function private.competition_identity_status(p_player uuid)
returns text language sql stable security definer set search_path='' as $$
 select case
 when u.id is null or u.email_confirmed_at is null or nullif(btrim(u.email),'') is null then 'verified_email_required'
 when exists(select 1 from auth.users other where other.id<>u.id and other.email_confirmed_at is not null
   and lower(btrim(other.email))=lower(btrim(u.email))
   and exists(select 1 from public.profiles p where p.user_id=other.id)) then 'identity_conflict'
 else 'allowed' end
 from (select p_player as id) requested left join auth.users u on u.id=requested.id;
$$;
revoke all on function private.competition_identity_status(uuid) from public,anon,authenticated,service_role;

-- Defense in depth for every official writer, including legacy start RPCs.
create function private.require_competition_identity()
returns trigger language plpgsql security definer set search_path='' as $$
 declare status text;
 begin
 if tg_op='UPDATE' and new.status<>'finalized' then return new; end if;
 status:=private.competition_identity_status(coalesce(to_jsonb(new)->>'player_id',to_jsonb(new)->>'user_id')::uuid);
 if status<>'allowed' then raise exception 'Competition identity unavailable' using errcode='42501'; end if;
 return new;
 end;
$$;
revoke all on function private.require_competition_identity() from public,anon,authenticated,service_role;
create trigger require_competition_identity before insert or update of status on public.game_sessions
 for each row execute function private.require_competition_identity();
create trigger require_competition_identity before insert or update of status on private.flappy_sessions
 for each row execute function private.require_competition_identity();

create function public.rtw_record_competition_access(p_player uuid,p_game text,p_network_hmac text default null)
returns text language plpgsql security definer set search_path='' as $$
 declare status text; game uuid;
 begin
 if p_game not in ('race-to-win','flappy-race') or p_game is null then raise exception 'Invalid game'; end if;
 status:=private.competition_identity_status(p_player);
 if status='identity_conflict' then
   perform pg_advisory_xact_lock(hashtextextended('identity:'||p_player::text,0));
   select id into game from public.games where slug=p_game;
   insert into public.fraud_flags(player_id,game_id,subject_type,subject_id,severity,signal_summary,signal_data)
   select p_player,game,'player',p_player,'high','Verified email identity conflict; administrative review required',
     jsonb_build_object('code','verified_email_conflict','automaticAccountBan',false)
   where not exists(select 1 from public.fraud_flags where player_id=p_player and game_id=game
     and signal_data->>'code'='verified_email_conflict' and created_at>now()-interval '30 days');
 end if;
 if status<>'allowed' then return status; end if;
 if p_network_hmac is not null then
   if p_network_hmac !~ '^[0-9a-f]{64}$' then raise exception 'Invalid evidence'; end if;
   insert into private.competition_network_evidence(player_id,game_slug,day,network_hmac)
   values(p_player,p_game,(now() at time zone 'UTC')::date,p_network_hmac)
   on conflict(player_id,game_slug,day,network_hmac) do update set last_seen=now();
 end if;
 return status;
 end;
$$;
revoke all on function public.rtw_record_competition_access(uuid,text,text) from public,anon,authenticated;
grant execute on function public.rtw_record_competition_access(uuid,text,text) to service_role;

create function public.rtw_admin_identity_evidence(p_actor uuid,p_player uuid,p_week date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
 begin
 if not exists(select 1 from private.admin_users where user_id=p_actor and is_active) then
   raise exception 'Administrator required' using errcode='42501'; end if;
 if p_week is null or extract(isodow from p_week)<>1 then raise exception 'Invalid week'; end if;
 return jsonb_build_object(
   'identityStatus',private.competition_identity_status(p_player),
   'networkReputation','not_configured',
   'sharedConnectionIsProof',false,
   'retentionDays',30,
   'relatedAccounts',coalesce((
     select jsonb_agg(jsonb_build_object('playerId',r.player_id,'username',p.username,
       'signal',r.signal,'sharedDays',r.shared_days,'confidence',r.confidence))
     from (
       select other.player_id,'shared_network'::text signal,count(distinct own.day) shared_days,'informational'::text confidence
       from private.competition_network_evidence own join private.competition_network_evidence other
       on other.day=own.day and other.network_hmac=own.network_hmac and other.player_id<>own.player_id
       where own.player_id=p_player and own.day between p_week and p_week+6
         and own.first_seen>now()-interval '30 days' and other.first_seen>now()-interval '30 days'
       group by other.player_id
       union all
       select other.user_id,'shared_payout_contact',0,'low'
       from public.profiles own join public.profiles other on other.user_id<>own.user_id
         and lower(btrim(other.paypal_email))=lower(btrim(own.paypal_email))
       where own.user_id=p_player and nullif(btrim(own.paypal_email),'') is not null
       union all
       select other.id,'verified_email_conflict',0,'high'
       from auth.users own join auth.users other on other.id<>own.id
         and lower(btrim(other.email))=lower(btrim(own.email))
       where own.id=p_player and own.email_confirmed_at is not null and other.email_confirmed_at is not null
     ) r left join public.profiles p on p.user_id=r.player_id
   ),'[]'::jsonb),
   'signals',coalesce((select jsonb_agg(jsonb_build_object('severity',f.severity,'status',f.status,
     'reason',f.signal_summary,'at',f.created_at)) from public.fraud_flags f
     where f.player_id=p_player and f.created_at>=p_week::timestamp at time zone 'America/New_York'
       and f.created_at<((p_week+7)::timestamp at time zone 'America/New_York')),'[]'::jsonb)
 );
 end;
$$;
revoke all on function public.rtw_admin_identity_evidence(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.rtw_admin_identity_evidence(uuid,uuid,date) to service_role;

-- A scheduled deletion bounds pseudonymous network storage. Also restrict readers
-- to the same 30-day window so expired evidence is never returned after job failure.
create function private.prune_competition_network_evidence()
returns void language sql security definer set search_path='' as $$
 delete from private.competition_network_evidence where first_seen<now()-interval '30 days';
$$;
revoke all on function private.prune_competition_network_evidence() from public,anon,authenticated,service_role;
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   perform cron.schedule('competition_network_retention','17 4 * * *','select private.prune_competition_network_evidence()');
 end if;
end $$;

-- Reuse tournament totals and provisional awards. Only this append-only decision
-- history is new; it does not replace or duplicate the financial ledger.
create table private.rtw_winner_case_events (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id),
 week date not null,
 player_id uuid not null references auth.users(id),
 actor uuid not null references auth.users(id),
 decision text not null check(decision in ('under_review','verified','disqualified','approved_for_payment','paid','expired','claim_started')),
 note text not null check(char_length(note) between 1 and 500),
 created_at timestamptz not null default now(),
 unique(game_id,week,player_id,decision)
);
alter table private.rtw_winner_case_events enable row level security;
revoke all on private.rtw_winner_case_events from public,anon,authenticated,service_role;

create function private.rtw_effective_winner_candidates(p_week date)
returns table(player_id uuid,rank_position bigint,weekly_total_score bigint,tie_break_status text)
language sql stable security definer set search_path='' as $$
 with eligible as (
   select t.* from public.weekly_tournament_totals t join public.games g on g.id=t.game_id
   where g.slug='race-to-win' and t.tournament_week_start=p_week
   and now()>=((p_week+7)::timestamp at time zone 'America/New_York')
   and not exists(select 1 from public.provisional_winners w where w.game_id=t.game_id
     and w.tournament_week_start=p_week and w.player_id=t.player_id
     and w.award_type='weekly_tournament' and w.status='disqualified')
 ), resolved as (
 select e.* from eligible e where e.tie_break_status='resolved'
 and e.rank_position<coalesce((select min(x.rank_position) from eligible x where x.tie_break_status='exact_tie'),2147483647)
 ), fixed as (
 select e.player_id,e.rank_position::bigint position,e.weekly_total_score::bigint score,e.tie_break_status
 from resolved e where e.rank_position<=3
 ), vacancies as (
 select slot,row_number() over(order by slot) ordinal from generate_series(1,3) slot
 where not exists(select 1 from fixed f where f.position=slot)
 ), replacements as (
 select e.*,row_number() over(order by e.rank_position) ordinal from resolved e where e.rank_position>3
 ) select player_id,position,score,tie_break_status from fixed
 union all
 select r.player_id,v.slot::bigint,r.weekly_total_score::bigint,r.tie_break_status
 from replacements r join vacancies v on v.ordinal=r.ordinal;
$$;
revoke all on function private.rtw_effective_winner_candidates(date) from public,anon,authenticated,service_role;
create function public.rtw_admin_read_winner_candidates(p_actor uuid,p_week date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from private.admin_users where user_id=p_actor and is_active) then
   raise exception 'Administrator required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('history',coalesce((
   select jsonb_agg(jsonb_build_object('decision',e.decision,'note',e.note,'at',e.created_at) order by e.created_at)
   from private.rtw_winner_case_events e where e.week=p_week and e.game_id=g.id
 ),'[]'::jsonb)) order by c.rank_position)
 from private.rtw_effective_winner_candidates(p_week) c cross join public.games g where g.slug='race-to-win'),'[]'::jsonb);
end;
$$;
revoke all on function public.rtw_admin_read_winner_candidates(uuid,date) from public,anon,authenticated;
grant execute on function public.rtw_admin_read_winner_candidates(uuid,date) to service_role;

create function public.rtw_admin_reject_winner_candidate(p_actor uuid,p_week date,p_player uuid,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare candidate record; game uuid; winner uuid; state text;
begin
 if not exists(select 1 from private.admin_users where user_id=p_actor and is_active) then
   raise exception 'Administrator required' using errcode='42501'; end if;
 if p_note is null or char_length(btrim(p_note)) not between 1 and 500 then raise exception 'Reason required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('rtw-candidates:'||p_week::text,0));
 select id into game from public.games where slug='race-to-win';
 if exists(select 1 from private.rtw_winner_case_events where game_id=game and week=p_week and player_id=p_player and decision='disqualified') then return; end if;
 select * into candidate from private.rtw_effective_winner_candidates(p_week) where player_id=p_player;
 if not found then raise exception 'Not a current candidate'; end if;
 insert into public.provisional_winners(game_id,player_id,tournament_week_start,award_type,rank_position,amount_cents,allocation_status,claim_deadline_at)
 values(game,p_player,p_week,'weekly_tournament',candidate.rank_position,
 case candidate.rank_position when 1 then 1500 when 2 then 300 else 200 end,'allocated',((p_week+14)::timestamp at time zone 'America/New_York'))
 on conflict do nothing;
 select id,status into winner,state from public.provisional_winners where game_id=game and player_id=p_player and tournament_week_start=p_week and award_type='weekly_tournament' for update;
 -- Financial commitments need the existing reversal workflow, never silently
 -- create a substitute award while an earlier credit or payment remains.
 if state in ('approved_for_payment','paid') then raise exception 'Financial review required'; end if;
 perform public.rtw_admin_transition_winner(p_actor,winner,'disqualified',p_note);

end;
$$;
revoke all on function public.rtw_admin_reject_winner_candidate(uuid,date,uuid,text) from public,anon,authenticated;
grant execute on function public.rtw_admin_reject_winner_candidate(uuid,date,uuid,text) to service_role;

-- Automatic weekly candidate preparation grants no credit and never pays.
create function private.rtw_prepare_previous_week_candidates()
returns void language plpgsql security definer set search_path='' as $$
declare week date:=date_trunc('week',now() at time zone 'America/New_York')::date-7; game uuid;
begin
 select id into game from public.games where slug='race-to-win';
 if game is null then return; end if;
 perform pg_advisory_xact_lock(hashtextextended('rtw-candidates:'||week::text,0));
 insert into public.provisional_winners(game_id,player_id,tournament_week_start,award_type,rank_position,amount_cents,allocation_status,claim_deadline_at)
 select game,c.player_id,week,'weekly_tournament',c.rank_position,
 case c.rank_position when 1 then 1500 when 2 then 300 else 200 end,'allocated',((week+14)::timestamp at time zone 'America/New_York')
 from private.rtw_effective_winner_candidates(week) c on conflict do nothing;
end;
$$;
revoke all on function private.rtw_prepare_previous_week_candidates() from public,anon,authenticated,service_role;
select cron.schedule('rtw_prepare_previous_week_candidates','25 5 * * *','select private.rtw_prepare_previous_week_candidates()');

-- Keep the established authorization, state machine and ledger operations;
-- append an immutable decision receipt in the same transaction.
create or replace function public.rtw_admin_transition_winner(
  p_actor_user_id uuid,
  p_winner_id uuid,
  p_new_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner public.provisional_winners%rowtype;
begin
  if not exists (
    select 1 from private.admin_users
    where user_id = p_actor_user_id and is_active
  ) then
    raise exception 'Administrator authorization is required.' using errcode = '42501';
  end if;

  select * into v_winner
  from public.provisional_winners
  where id = p_winner_id
  for update;
  if not found then raise exception 'Winner record unavailable.' using errcode = 'P0002'; end if;

  if p_new_status = 'disqualified' and v_winner.status = 'paid' then
    -- A paid award is immutable financial history. Preserve it and create a
    -- review signal instead of rewriting a past payment or its ledger trail.
    perform private.flag_paid_winner_for_review(v_winner, p_actor_user_id);
    return;
  end if;
  if p_new_status = 'disqualified' and v_winner.status = 'approved_for_payment' then
    if not private.reverse_provisional_winner_credit(v_winner.id, p_actor_user_id) then
      return;
    end if;
  end if;

  update public.provisional_winners
  set status = p_new_status,
      admin_note = coalesce(p_note, admin_note)
  where id = p_winner_id
  returning * into v_winner;
  if not found then raise exception 'Winner record unavailable.' using errcode = 'P0002'; end if;

  if v_winner.award_type='weekly_tournament' and exists(select 1 from public.games where id=v_winner.game_id and slug='race-to-win') then
    insert into private.rtw_winner_case_events(game_id,week,player_id,actor,decision,note)
    values(v_winner.game_id,v_winner.tournament_week_start,v_winner.player_id,p_actor_user_id,p_new_status,
      left(coalesce(nullif(btrim(p_note),''),'Administrative state transition'),500))
    on conflict(game_id,week,player_id,decision) do nothing;
  end if;

  if p_new_status = 'approved_for_payment' then
    if v_winner.allocation_status <> 'allocated' or v_winner.amount_cents is null then
      raise exception 'Winner allocation must be finalized before approval.' using errcode = '23514';
    end if;
    insert into public.prize_ledger_entries (
      player_id, game_id, provisional_winner_id, entry_type, amount_cents, reason, created_by_user_id
    )
    values (
      v_winner.player_id,
      v_winner.game_id,
      v_winner.id,
      'credit',
      v_winner.amount_cents,
      'Approved provisional prize',
      p_actor_user_id
    )
    on conflict (provisional_winner_id) where entry_type = 'credit' do nothing;
  end if;
end;
$$;
