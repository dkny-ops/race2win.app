-- Only disposable local Auth placeholders required by hard-coded historical FK inserts.
-- No production users or personal information are copied.
insert into auth.users(id,email_confirmed_at) values
 ('89565250-aafb-4508-a945-39cb329a5650',now()),
 ('9a216afd-7447-41d2-a7d0-e701cd579d14',now());
