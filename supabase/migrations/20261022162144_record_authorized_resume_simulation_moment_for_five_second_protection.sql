alter table private.rtw_human_check_history add column if not exists resume_simulation_ms integer;
alter table private.rtw_human_check_history add constraint rtw_resume_simulation_ms_valid check (resume_simulation_ms is null or resume_simulation_ms between 0 and 3600000);
create index if not exists rtw_human_history_session_resume_idx on private.rtw_human_check_history(session_id,resume_simulation_ms) where resume_simulation_ms is not null;;
