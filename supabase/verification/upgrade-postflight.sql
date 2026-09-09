-- Read-only verification. Success means this upgrade is already installed: SKIP applying it again.
do $postflight$
declare v text;
begin
 select md5(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) order by version)::text) into v
 from supabase_migrations.schema_migrations where version <> '20260909185036';
 if v <> 'd05c5d828414c5b708941e154dffa5f4' then raise exception 'Historical entries changed or unexpected migrations installed'; end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20260909185036' and name='converge_test_migration_state' and md5(to_jsonb(statements)::text)='2148eb67041b589e00c6226d4b20f776') then raise exception 'Expected new migration is absent or its SQL differs'; end if;
 select md5(snapshot::text) into v from (select jsonb_build_object(
'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and (n.nspname='private' or p.proname like 'rtw_%')),
'indexes',(select jsonb_agg(to_jsonb(i) order by schemaname,indexname) from pg_indexes i where schemaname in ('public','private')),
'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p where schemaname in ('public','private')),
'triggers',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by n.nspname,c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','private')),
'columns',(select jsonb_agg(to_jsonb(c) order by table_schema,table_name,ordinal_position) from information_schema.columns c where table_schema in ('public','private')),
'grants',(select jsonb_agg(to_jsonb(g) order by table_schema,table_name,grantee,privilege_type) from information_schema.role_table_grants g where table_schema in ('public','private')),
'column_grants',(select jsonb_agg(to_jsonb(g) order by table_schema,table_name,column_name,grantee,privilege_type) from information_schema.role_column_grants g where table_schema in ('public','private')),
'constraints',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',co.conname,'definition',pg_get_constraintdef(co.oid)) order by n.nspname,c.relname,co.conname) from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private')),
'rls',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r')
) as snapshot) as current_state;
 if v <> 'b0bdeb894132411f4b9cc8a25a6155c0' then raise exception 'Final schema does not match verified state'; end if;
end $postflight$;
select 'PASS upgrade installed; seven historical entries unchanged; SKIP reapplication' as result;

