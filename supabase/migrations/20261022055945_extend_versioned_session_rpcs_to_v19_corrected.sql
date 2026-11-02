do $migration$
declare v_name text; v_oid oid; v_sql text;
begin
 foreach v_name in array array['protect_game_session_integrity','rtw_finalize_game_session_with_checkpoints','rtw_record_game_session_checkpoint_with_lease','rtw_start_official_game_session_v3','validate_game_session_checkpoint']
 loop
  select oid into strict v_oid from pg_proc where proname=v_name;
  v_sql := pg_get_functiondef(v_oid);
  v_sql := replace(v_sql, 'old.gameplay_version <> ''rtw-v18''', 'old.gameplay_version not in (''rtw-v18'', ''rtw-v19'')');
  v_sql := replace(v_sql, 'v_session.gameplay_version = ''rtw-v18''', 'v_session.gameplay_version in (''rtw-v18'', ''rtw-v19'')');
  v_sql := replace(v_sql, '''rtw-v18'')', '''rtw-v18'', ''rtw-v19'')');
  execute v_sql;
 end loop;
end $migration$;;
