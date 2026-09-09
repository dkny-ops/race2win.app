-- Read-only guard for the authorized existing TEST baseline only.
do $preflight$
declare v_history text; v_catalog text;
begin
 select md5(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) order by version)::text)
 into v_history from supabase_migrations.schema_migrations;
 if v_history <> 'd05c5d828414c5b708941e154dffa5f4' then raise exception 'Unexpected migration history; STOP, do not repair or push'; end if;
 select md5(snapshot::text) into v_catalog from (select jsonb_build_object(
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
 if v_catalog <> 'cf34b92a60381bb95b18d9bd0296ab85' then raise exception 'Unexpected schema state; STOP and inspect drift'; end if;
end $preflight$;
select 'PASS exact TEST baseline; apply only converge_test_migration_state' as result;

