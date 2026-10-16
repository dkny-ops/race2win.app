-- TEST lndvnufmbuzdbinapvze only. Pending final owner approval.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

DO $cleanup$
DECLARE
  v_run_id text := '9e2a75ac-f5bd-496a-bd08-6d0a0f2c79d5';
  v_game_id uuid := 'd74fbfee-cbef-4f14-b030-a8bb905d1810';
  v_week date := private.ny_tournament_week_start('2099-02-09T16:00:00Z');
  v_players uuid[] := ARRAY[
    'f8024b5a-c169-49e9-ad74-029735be3b20'::uuid,
    '3c667506-e7ca-4863-99f8-beea9d335986'::uuid
  ];
  v_sessions uuid[] := ARRAY[
    '49c8e773-a4eb-4407-844a-5e7cb36da39a'::uuid,
    '60aefb0c-7509-41b5-be7a-d77c58033b22'::uuid,
    '976cbbab-018e-4fdb-b00e-097a6654bbef'::uuid,
    '8422cdab-3acf-4e27-842a-c92a254fa3dc'::uuid,
    '06a355f8-7285-469f-9ce4-2132abc03ed8'::uuid,
    'adc9fcf2-caeb-4ef4-a37b-c68a03356c9b'::uuid,
    'ceb47f97-2e79-47c3-aabe-cacc4c3b54b3'::uuid,
    '97afe820-b4b4-4c0b-8ca5-910f0f910af3'::uuid,
    'be377889-3a51-4b88-b572-52fd0d1db20d'::uuid,
    '4c3fcb21-3ffd-41a7-8378-2551173d3d03'::uuid,
    '90607997-08b1-4a48-9712-c6305a1383c5'::uuid,
    'c9c65ac1-dae8-4070-aa65-ae2b1dc145a4'::uuid,
    '904ebddf-178e-48b1-b304-ad9517979a45'::uuid,
    'ef5b3d77-24cc-41b5-9a5c-5fddf697bc6f'::uuid,
    '64b09fca-bd28-40dd-a3ea-8e49fd993c31'::uuid
  ];
BEGIN
  -- Lock only identities already marked as belonging to this run.
  PERFORM id FROM auth.users
  WHERE id = ANY(v_players)
    AND raw_app_meta_data->>'rtw_concurrency_api' = v_run_id
  ORDER BY id FOR UPDATE;

  -- These row locks block finalization and checkpoint insertion for these fixtures.
  PERFORM id FROM public.game_sessions
  WHERE id = ANY(v_sessions) AND user_id = ANY(v_players)
    AND game_id = v_game_id
    AND started_at = '2099-02-09T16:00:00Z'::timestamptz
  ORDER BY id FOR UPDATE;

  IF (SELECT count(*) FROM auth.users
      WHERE id = ANY(v_players)
        AND raw_app_meta_data->>'rtw_concurrency_api' = v_run_id) <> 2
  THEN RAISE EXCEPTION 'Synthetic ownership not confirmed'; END IF;

  IF (SELECT count(*) FROM public.game_sessions
      WHERE id = ANY(v_sessions) AND user_id = ANY(v_players)
        AND game_id = v_game_id
        AND started_at = '2099-02-09T16:00:00Z'::timestamptz) <> 15
     OR EXISTS (SELECT 1 FROM public.game_sessions
                WHERE user_id = ANY(v_players) AND id <> ALL(v_sessions))
  THEN RAISE EXCEPTION 'Unexpected or missing synthetic sessions'; END IF;

  IF EXISTS (SELECT 1 FROM public.provisional_winners
             WHERE player_id = ANY(v_players))
     OR EXISTS (SELECT 1 FROM public.prize_ledger_entries
                WHERE player_id = ANY(v_players)
                   OR created_by_user_id = ANY(v_players))
     OR EXISTS (SELECT 1 FROM public.prize_balances
                WHERE player_id = ANY(v_players))
     OR EXISTS (SELECT 1 FROM public.payouts
                WHERE player_id = ANY(v_players))
  THEN RAISE EXCEPTION 'Unexpected financial data'; END IF;

  IF EXISTS (SELECT 1 FROM public.validated_runs
             WHERE tournament_week_start = v_week
               AND player_id <> ALL(v_players))
     OR EXISTS (SELECT 1 FROM public.daily_top_scores
                WHERE tournament_week_start = v_week
                  AND player_id <> ALL(v_players))
     OR EXISTS (SELECT 1 FROM public.weekly_tournament_totals
                WHERE tournament_week_start = v_week
                  AND player_id <> ALL(v_players))
  THEN RAISE EXCEPTION 'Foreign data in isolated week'; END IF;

  -- Mandatory guard immediately before DELETE. Zero rows means no row DELETE trigger.
  IF EXISTS (SELECT 1 FROM public.validated_runs
             WHERE player_id = ANY(v_players)
                OR game_session_id = ANY(v_sessions))
  THEN RAISE EXCEPTION 'Validated fixture result exists: cleanup aborted'; END IF;

  DELETE FROM public.daily_top_scores
  WHERE player_id = ANY(v_players) AND game_id = v_game_id
    AND tournament_week_start = v_week
    AND validated_run_id IN (
      SELECT id FROM public.validated_runs
      WHERE player_id = ANY(v_players) AND game_session_id = ANY(v_sessions)
    );

  DELETE FROM public.validated_runs
  WHERE player_id = ANY(v_players) AND game_session_id = ANY(v_sessions)
    AND game_id = v_game_id AND tournament_week_start = v_week;

  DELETE FROM private.game_session_checkpoints
  WHERE player_id = ANY(v_players) AND game_session_id = ANY(v_sessions);

  DELETE FROM public.game_sessions
  WHERE id = ANY(v_sessions) AND user_id = ANY(v_players) AND game_id = v_game_id;

  DELETE FROM public.weekly_tournament_totals
  WHERE player_id = ANY(v_players) AND game_id = v_game_id
    AND tournament_week_start = v_week;

  DELETE FROM private.competition_action_rate_limits
  WHERE player_id = ANY(v_players) AND action = 'game_checkpoint';

  DELETE FROM auth.users
  WHERE id = ANY(v_players)
    AND raw_app_meta_data->>'rtw_concurrency_api' = v_run_id;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = ANY(v_players))
     OR EXISTS (SELECT 1 FROM public.game_sessions
                WHERE id = ANY(v_sessions) OR user_id = ANY(v_players))
     OR EXISTS (SELECT 1 FROM public.validated_runs WHERE player_id = ANY(v_players))
     OR EXISTS (SELECT 1 FROM public.daily_top_scores WHERE player_id = ANY(v_players))
     OR EXISTS (SELECT 1 FROM public.weekly_tournament_totals WHERE player_id = ANY(v_players))
     OR EXISTS (SELECT 1 FROM private.game_session_checkpoints
                WHERE game_session_id = ANY(v_sessions) OR player_id = ANY(v_players))
     OR EXISTS (SELECT 1 FROM private.competition_action_rate_limits
                WHERE player_id = ANY(v_players))
  THEN RAISE EXCEPTION 'Cleanup incomplete: transaction aborted'; END IF;
END;
$cleanup$;

COMMIT;
