-- Defense in depth for an internal award-generation idempotency ledger.
-- Browser roles have no private-schema USAGE, table grants, or executable
-- award-generation RPCs. There are deliberately no permissive policies here:
-- only service_role (which has BYPASSRLS) and the existing privileged
-- generation flow may access this relation.
alter table private.competition_award_generations enable row level security;
