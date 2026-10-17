-- Ensure that after a session is finalized the competition week is refreshed
-- This is a non-destructive helper that invokes the private refresh routine
-- for the week that contains the finalized session's completion. It is a
-- safety valve to ensure daily_top_scores and weekly_tournament_totals are
-- rebuilt if the trigger path missed or a race condition occurred.

create or replace function public.rtw_post_finalize_refresh_week(p_session_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_game_id uuid;
  v_week_start date;
  v_started_at timestamptz;
  v_final_elapsed_ms integer;
  v_completed_at timestamptz;
begin
  -- Read the session under FOR UPDATE to ensure we have canonical values
  select game_id, started_at, final_elapsed_ms
    into v_game_id, v_started_at, v_final_elapsed_ms
  from public.game_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Session not found' using errcode='P0002';
  end if;

  if v_final_elapsed_ms is null then
    -- Nothing to refresh if session wasn't finalized with a final elapsed
    return;
  end if;

  v_completed_at := v_started_at + (v_final_elapsed_ms * interval '1 millisecond');
  v_week_start := private.ny_tournament_week_start(v_completed_at);

  -- Call the private refresh; it is safe and idempotent.
  perform private.refresh_competition_week(v_game_id, v_week_start);
end;
$$;

revoke all on function public.rtw_post_finalize_refresh_week(uuid) from public, anon, authenticated;
grant execute on function public.rtw_post_finalize_refresh_week(uuid) to service_role;
