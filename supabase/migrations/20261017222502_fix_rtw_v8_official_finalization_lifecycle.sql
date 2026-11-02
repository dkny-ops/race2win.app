DO $migration$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rtw_finalize_game_session_with_checkpoints';
  IF v_definition IS NULL THEN RAISE EXCEPTION 'Finalization function not found'; END IF;
  IF position('v_session.gameplay_version = ''rtw-v7'' and v_session.checkpoint_interval_score = 1000' in v_definition) = 0
     OR position('if v_session.gameplay_version = ''rtw-v7'' and v_session.activity_lease_expires_at <= v_now then' in v_definition) = 0
  THEN RAISE EXCEPTION 'Expected legacy finalization guards missing'; END IF;
  v_updated := replace(v_definition,
    'v_session.gameplay_version = ''rtw-v7'' and v_session.checkpoint_interval_score = 1000',
    'v_session.gameplay_version in (''rtw-v7'', ''rtw-v8'') and v_session.checkpoint_interval_score = 1000');
  v_updated := replace(v_updated,
    'if v_session.gameplay_version = ''rtw-v7'' and v_session.activity_lease_expires_at <= v_now then',
    'if v_session.gameplay_version in (''rtw-v7'', ''rtw-v8'') and v_session.activity_lease_expires_at <= v_now then');
  EXECUTE v_updated;
END;
$migration$;;
