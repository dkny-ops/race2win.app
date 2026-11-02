-- Disposable platform scaffold only. Does NOT test or run background scheduling.
-- The reconciliation does not change cron jobs; scheduler behavior is outside scope.
create schema cron;
create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text);
create function cron.schedule(text,text,text) returns bigint language plpgsql as $$
declare result bigint;
begin
 insert into cron.job(jobname,schedule,command) values($1,$2,$3)
 on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command
 returning jobid into result; return result;
end $$;
