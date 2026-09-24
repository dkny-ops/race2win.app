-- The original inline CHECK was named by PostgreSQL as
-- game_session_checkpoints_check, not the guessed name in the v7 migration.
-- It encoded the historical 5,000-point interval and conflicts with valid
-- rtw-v7 1,000-point rows. Version-specific interval enforcement remains in
-- private.validate_game_session_checkpoint(), while this migration removes
-- only the obsolete cross-version constraint.
alter table private.game_session_checkpoints
  drop constraint if exists game_session_checkpoints_check;
