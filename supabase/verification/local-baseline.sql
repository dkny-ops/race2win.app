-- Synthetic fixtures only. Loaded exclusively by rehearse-local.mjs (no URL).
insert into auth.users(id,email_confirmed_at) values
('11111111-1111-4111-8111-111111111111',now()),
('22222222-2222-4222-8222-222222222222',now()),
('33333333-3333-4333-8333-333333333333',now());
insert into public.profiles(user_id,username) values('11111111-1111-4111-8111-111111111111','FixtureOwner');
insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',id,'rtw-v6',1,now(),now()+interval '10 minutes' from public.games where slug='race-to-win';
insert into public.game_sessions(id,user_id,game_id,gameplay_version,seed,started_at,expires_at)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',id,'rtw-v6',2,'2026-10-05 16:00Z','2026-10-05 16:10Z' from public.games where slug='race-to-win';
update public.game_sessions set status='finalized',finalized_at='2026-10-05 16:00:01Z',input_digest=repeat('a',64),input_count=0,final_score=100,final_distance_millimeters=100000,final_elapsed_ms=1000,final_collision_at_ms=1000 where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
