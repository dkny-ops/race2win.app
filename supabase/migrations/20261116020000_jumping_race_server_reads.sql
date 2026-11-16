-- Server-only reads needed for authoritative Jumping Race session processing.
create or replace function public.jr_competition_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled from private.jumping_race_control where singleton = true), false)
$$;
create or replace function public.jr_session_info(p_session_id uuid, p_player_id uuid)
returns table(started_at timestamptz, status text, next_checkpoint integer)
language sql stable security definer set search_path = '' as $$
  select s.started_at, s.status, s.next_checkpoint
  from private.jumping_race_sessions s where s.id = p_session_id and s.player_id = p_player_id
$$;
create or replace function public.jr_session_batches(p_session_id uuid, p_player_id uuid)
returns table(checkpoint_index integer, actions jsonb)
language sql stable security definer set search_path = '' as $$
  select b.checkpoint_index, b.actions from private.jumping_race_action_batches b
  join private.jumping_race_sessions s on s.id = b.session_id
  where s.id = p_session_id and s.player_id = p_player_id
  order by b.checkpoint_index
$$;
revoke all on function public.jr_competition_enabled(), public.jr_session_info(uuid,uuid), public.jr_session_batches(uuid,uuid) from public, anon, authenticated;
grant execute on function public.jr_competition_enabled(), public.jr_session_info(uuid,uuid), public.jr_session_batches(uuid,uuid) to service_role;
