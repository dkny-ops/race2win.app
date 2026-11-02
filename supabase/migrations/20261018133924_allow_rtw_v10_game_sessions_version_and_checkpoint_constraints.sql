alter table public.game_sessions drop constraint game_sessions_gameplay_version_check;
alter table public.game_sessions add constraint game_sessions_gameplay_version_check check (gameplay_version = any (array['rtw-v6','rtw-v7','rtw-v8','rtw-v9','rtw-v10']));
alter table public.game_sessions drop constraint game_sessions_versioned_checkpoint_lease_shape;
alter table public.game_sessions add constraint game_sessions_versioned_checkpoint_lease_shape check (
 (gameplay_version='rtw-v6' and checkpoint_interval_score is null and activity_lease_expires_at is null)
 or (gameplay_version = any(array['rtw-v7','rtw-v8','rtw-v9','rtw-v10']) and checkpoint_interval_score=1000 and activity_lease_expires_at is not null)
);;
