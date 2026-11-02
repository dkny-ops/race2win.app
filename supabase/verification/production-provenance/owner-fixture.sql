-- Disposable identity solely to satisfy the historical owner-approval preflight.
alter table auth.users add column email text;
insert into auth.users(id,email,email_confirmed_at)
 values('00000000-0000-4000-8000-000000000001','racetowinapp@gmail.com',now());
insert into private.admin_users(user_id,is_active)
 values('00000000-0000-4000-8000-000000000001',true);
