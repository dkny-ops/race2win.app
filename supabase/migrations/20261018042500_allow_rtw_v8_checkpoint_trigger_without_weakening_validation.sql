DO $migration$
DECLARE v_definition text; v_updated text;
BEGIN
 SELECT pg_get_functiondef('private.validate_game_session_checkpoint()'::regprocedure) INTO v_definition;
 IF position('v_session.gameplay_version <> ''rtw-v7''' in v_definition)=0 THEN
   RAISE EXCEPTION 'Expected v7-only checkpoint guard missing';
 END IF;
 v_updated := replace(v_definition,
   'v_session.gameplay_version <> ''rtw-v7''',
   'v_session.gameplay_version not in (''rtw-v7'', ''rtw-v8'')');
 EXECUTE v_updated;
END;
$migration$;;
