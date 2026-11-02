begin;
create temporary table reconcile_row_sentinels(schema_name text,table_name text,row_hash text);
do $before$
declare t record; h text;
begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' loop
 execute format('select md5(coalesce(string_agg(to_jsonb(r)::text,%L order by to_jsonb(r)::text),%L)) from %I.%I r','','',t.nspname,t.relname) into h;
 insert into reconcile_row_sentinels values(t.nspname,t.relname,h);
 end loop;
end $before$;
-- @RECONCILIATION_SQL@-- @RECONCILIATION_SQL@do $after$
declare t record; h text;
begin
 for t in select * from reconcile_row_sentinels loop
 execute format('select md5(coalesce(string_agg(to_jsonb(r)::text,%L order by to_jsonb(r)::text),%L)) from %I.%I r','','',t.schema_name,t.table_name) into h;
 if h is distinct from t.row_hash then raise exception 'Rows changed in %.%',t.schema_name,t.table_name; end if;
 end loop;
 raise notice 'PASS: reconciliation executed twice, all 62 table contents unchanged';
end $after$;
select 'PASS marker repeated twice, fingerprints checked and every application table unchanged' as verification;
rollback;

