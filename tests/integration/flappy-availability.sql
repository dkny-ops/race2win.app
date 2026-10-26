-- Isolated PostgreSQL fixture only; see docs/flappy-interface-validation.md.
\set ON_ERROR_STOP on
begin;
insert into private.flappy_sessions values
 ('11111111-1111-4111-8111-111111111111',clock_timestamp()-interval '61 minutes','expired',clock_timestamp(),clock_timestamp());
do $$ declare a jsonb; begin
 a:=public.flappy_read_availability('11111111-1111-4111-8111-111111111111');
 assert (a->>'remaining')::int=5; assert a->>'nextAvailableAt' is null;
end $$;
insert into private.flappy_sessions
select '11111111-1111-4111-8111-111111111111',clock_timestamp()-n*interval '10 minutes','finalized',clock_timestamp(),clock_timestamp() from generate_series(1,5)n;
do $$ declare a jsonb; begin
 a:=public.flappy_read_availability('11111111-1111-4111-8111-111111111111');
 assert (a->>'remaining')::int=0;
 assert abs(extract(epoch from (a->>'nextAvailableAt')::timestamptz-clock_timestamp())-600)<2;
 assert (public.flappy_read_availability('22222222-2222-4222-8222-222222222222')->>'remaining')::int=5;
 assert not has_function_privilege('anon','public.flappy_read_availability(uuid)','execute');
 assert not has_function_privilege('authenticated','public.flappy_read_availability(uuid)','execute');
 assert has_function_privilege('service_role','public.flappy_read_availability(uuid)','execute');
 assert not has_table_privilege('service_role','private.flappy_sessions','select');
end $$;
update private.flappy_sessions set created_at=clock_timestamp()-interval '61 minutes' where created_at<clock_timestamp()-interval '49 minutes';
do $$ declare a jsonb; begin
 a:=public.flappy_read_availability('11111111-1111-4111-8111-111111111111');
 assert (a->>'remaining')::int=1;
 assert abs(extract(epoch from (a->>'nextAvailableAt')::timestamptz-clock_timestamp())-1200)<2;
end $$;
rollback;
