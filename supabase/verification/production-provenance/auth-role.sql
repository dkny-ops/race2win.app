create function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
 nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')
$$;
grant execute on function auth.role() to anon,authenticated,service_role;
