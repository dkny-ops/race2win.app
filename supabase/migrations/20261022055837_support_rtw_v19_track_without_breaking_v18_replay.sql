alter table public.game_sessions drop constraint game_sessions_gameplay_version_check;
alter table public.game_sessions add constraint game_sessions_gameplay_version_check check (gameplay_version in ('rtw-v6','rtw-v7','rtw-v8','rtw-v9','rtw-v10','rtw-v11','rtw-v12','rtw-v13','rtw-v14','rtw-v15','rtw-v16','rtw-v17','rtw-v18','rtw-v19'));
alter table public.game_sessions drop constraint game_sessions_versioned_checkpoint_lease_shape;
alter table public.game_sessions add constraint game_sessions_versioned_checkpoint_lease_shape check ((gameplay_version='rtw-v6' and checkpoint_interval_score is null and activity_lease_expires_at is null) or (gameplay_version in ('rtw-v7','rtw-v8','rtw-v9','rtw-v10','rtw-v11','rtw-v12','rtw-v13','rtw-v14','rtw-v15','rtw-v16','rtw-v17','rtw-v18','rtw-v19') and checkpoint_interval_score=1000 and activity_lease_expires_at is not null));
alter table public.game_sessions drop constraint game_sessions_expiry_window;
alter table public.game_sessions add constraint game_sessions_expiry_window check (expires_at>started_at and (gameplay_version in ('rtw-v18','rtw-v19') or expires_at <= started_at + interval '10 minutes'));;
