# Invisible Flappy verification

Flappy uses the existing invisible Turnstile widget and `midrun_human_check`
action. The server schedules the first check 15–35 seconds after the start,
then 20–45 seconds after each successful check. Rendering and input continue
while the token is generated and verified. No click or symbol puzzle is added.

The existing live identity, terms/access restrictions and persistent checkpoint
quota protect the new same-origin endpoint. Cloudflare Siteverify must match
the action, allowed hostname and the current session's unique `cdata` nonce.
Only the service role can consume that nonce, with session ownership, active
lease, expiry, due time, a 30-second completion window and row locking checked
again in PostgreSQL. Tokens and raw provider responses are never logged.

A Flappy-only insert trigger rejects a result whose server-replayed collision
time passes an outstanding verification deadline. It runs inside the existing
finalization transaction. Runs ending before the first deadline and sessions
created before activation keep their existing behavior. Provider failures do
not ban players or authorize scores. A failed verification displays a retry
message. Verification does not prove a human played and does not replace replay,
fraud review or manual financial approval.

## Rollout

Apply only `20261101205957_flappy_invisible_midrun.sql`. It creates an independent
disabled control and adds no existing function replacements or prize changes.
Deploy the matching application code before enabling its database control.
Existing production `TURNSTILE_ENFORCEMENT_ENABLED` and `TURNSTILE_MIDRUN_ENABLED`
must be true and the original invisible widget credentials/hostnames configured.
Never use Managed login credentials for this widget.

Enable new-session checks with:

```sql
update private.flappy_turnstile_control set enabled=true where singleton=true;
```

Set this control false to stop attaching checks to new sessions. Retain existing
challenge evidence and allow already-protected sessions to complete normally.
Do not replay historical migrations or reset any database.

## Validation

`node --test tests/flappy-invisible.test.mjs tests/flappy-engine.test.mjs
tests/flappy-parity.test.mjs tests/otp-turnstile.test.mjs` tests the token binding,
API rejection paths, finalization coordination, cancellation and existing login
behavior. TypeScript and ESLint checks cover the changed application files.

`PSQL_BIN` selects a local psql executable for
`node tests/integration/flappy-turnstile-postgres.mjs`. It creates and drops a
disposable native PostgreSQL database at 127.0.0.1:55405 only. This port avoids
Windows's excluded 55406–55505 range on the development machine. The isolated
Auth scaffold is not GoTrue. The cron-registration stub does not test scheduling.
The test applies authoritative Flappy/identity schema history, excluding the
one-off owner activation and unrelated financial support migrations that depend
on remote-only history. It checks unchanged pre-existing functions, default-off
activation, random schedules, real RLS/grants, ownership, concurrent nonce
consumption, expiry and finalization enforcement.

These tests simulate Siteverify decisions. They do not certify a live authenticated
browser challenge or establish that a player is human.
