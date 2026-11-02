alter table public.game_sessions drop constraint game_sessions_gameplay_version_check;
alter table public.game_sessions add constraint game_sessions_gameplay_version_check check (gameplay_version in ('rtw-v6','rtw-v7','rtw-v8','rtw-v9','rtw-v10','rtw-v11','rtw-v12','rtw-v13','rtw-v14','rtw-v15','rtw-v16','rtw-v17','rtw-v18','rtw-v19','rtw-v20'));
alter table public.game_sessions drop constraint game_sessions_versioned_checkpoint_lease_shape;
alter table public.game_sessions add constraint game_sessions_versioned_checkpoint_lease_shape check ((gameplay_version='rtw-v6' and checkpoint_interval_score is null and activity_lease_expires_at is null) or (gameplay_version in ('rtw-v7','rtw-v8','rtw-v9','rtw-v10','rtw-v11','rtw-v12','rtw-v13','rtw-v14','rtw-v15','rtw-v16','rtw-v17','rtw-v18','rtw-v19','rtw-v20') and checkpoint_interval_score=1000 and activity_lease_expires_at is not null));
alter table public.game_sessions drop constraint game_sessions_expiry_window;
alter table public.game_sessions add constraint game_sessions_expiry_window check (expires_at>started_at and (gameplay_version in ('rtw-v18','rtw-v19','rtw-v20') or expires_at <= started_at + interval '10 minutes'));
do $migration$
declare v_name text; v_oid oid; v_sql text;
begin
 foreach v_name in array array['protect_game_session_integrity','rtw_finalize_game_session_with_checkpoints','rtw_record_game_session_checkpoint_with_lease','rtw_start_official_game_session_v3','validate_game_session_checkpoint']
 loop
  select oid into strict v_oid from pg_proc where proname=v_name;
  v_sql := pg_get_functiondef(v_oid);
  v_sql := replace(v_sql, 'old.gameplay_version not in (''rtw-v18'', ''rtw-v19'')', 'old.gameplay_version not in (''rtw-v18'', ''rtw-v19'', ''rtw-v20'')');
  v_sql := replace(v_sql, 'v_session.gameplay_version in (''rtw-v18'', ''rtw-v19'')', 'v_session.gameplay_version in (''rtw-v18'', ''rtw-v19'', ''rtw-v20'')');
  v_sql := replace(v_sql, '''rtw-v19'')', '''rtw-v19'', ''rtw-v20'')');
  execute v_sql;
 end loop;
end $migration$;;
