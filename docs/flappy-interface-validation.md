# FlappyRace availability and public competition interface

The availability endpoint verifies the live user session and existing terms/access
policy, then calls the service-role-only `flappy_read_availability` RPC. The RPC
counts all starts in `private.flappy_sessions` with the same strict rolling
60-minute predicate as `flappy_start`; it returns the earliest individual slot
recovery and a database clock reference. Browser time animates the display only.
PLAY always posts an empty body to the existing official start endpoint. Its
advisory transaction lock, one-active-session constraint, quota, replay validation,
RLS and grants remain unchanged. No prize/payment or weekly ranking changes.

Validation performed:
- Full Node test suite, TypeScript and production build.
- Targeted ESLint on changed application files (repository-wide lint has existing errors).
- Chromium and WebKit mobile browser checks with controlled API responses:
  available/exhausted, official start, automatic 3/5 → 2/5 refresh, disabled PLAY,
  no competition/practice selector, no horizontal overflow; screenshots reviewed.
- Isolated PostgreSQL 17 execution of the read function: expired starts excluded,
  finalized starts counted, next slot rather than a fixed hour, independent player,
  role grants and no new direct table privileges.
- Production read-only RPC and privilege checks; original `flappy_start` function
  fingerprint unchanged: `2831f0e2e9ded8a1091c9edd163dd1a1`.

The additive function alone was applied to production as migration
`20261026123618_flappy_read_availability`. No general migration push was run.
No authenticated player browser session or physical iPhone is available in this
workspace; controlled browser starts do not certify an authenticated production run.

To reproduce the isolated SQL checks, create an empty PostgreSQL 17 database with
roles anon, authenticated and service_role, schema private, and fixture tables:
`private.flappy_control(enabled boolean)` (one true row) and
`private.flappy_sessions(player_id uuid, created_at timestamptz, status text,
expires_at timestamptz, lease_until timestamptz)` with RLS enabled and no grants.
Apply only the read-availability migration there, then run
`tests/integration/flappy-availability.sql`. Never run fixture setup in production.
