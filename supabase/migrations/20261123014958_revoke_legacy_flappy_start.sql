-- The active Flappy server uses only flappy_start(uuid,bigint,text,uuid),
-- which atomically consumes a session-bound, Siteverify-validated preflight.
-- Retire the legacy three-argument entry point so a future server regression
-- cannot accidentally create an official session without that evidence.
-- This changes no session, run, ranking, prize, balance, or payment.
revoke all on function public.flappy_start(uuid,bigint,text) from public,anon,authenticated,service_role;
