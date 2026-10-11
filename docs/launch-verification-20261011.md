# Launch verification — 11 October 2026

Follow-up to local baseline commit 6bf4595. No Production write, public deployment, push or merge was executed. Awards, payouts, competition parameters and historical migrations are unchanged.

## Confirmed fixes

Browser actions carry a rounded timestamp of the already-completed simulation tick. Prequeued server replay formerly applied an action on that same tick, one step too early. A legal twelve-minute run survived locally but its replay crashed early (score 4631 instead of checkpoint 9000). Only v7 replay scheduling now moves past the submitted timestamp; original evidence/digests and v6 behavior remain unchanged. No simulation configuration, difficulty, scoring formula or checkpoint interval changed. Short boundary coverage spans ten seeds; a predictive test driver completes twelve minutes with ordinary inputs and checks progress/checkpoints and the final collision against authoritative replay.

Eight overlapping identical FINALIZE calls formerly produced one 200 and seven 409 responses. On a database status/check failure, the route now reads the canonical owner-scoped result and returns it only for finalized status and the identical digest. Expiry, foreign ownership, changed evidence and other conflicts remain rejected. SQL locking and immutable run creation are unchanged. Local route/SQL integration confirms eight canonical results and one validated run. This tests request interleaving over one local database connection, not hosted PostgreSQL lock contention.

## Verification

- Local suite includes the new long-run and rounded-input boundary regressions.
- Local PostgreSQL rehearsal: fresh 24 migrations, upgrade 9 to 24, preserved v6/profile/ranking data, injected early/late failures and retry, Top7/week/DST/RLS/ACL/OTP, no awards/payments.
- Local built-server HTTP: eight parallel unauthenticated calls for each START/checkpoint/FINALIZE endpoint return 401; missing Auth configuration cannot issue an OTP challenge; missing OTP admission rejected; profile/scores denied; guest game renders.
- Live Cloudflare Siteverify with its publicly documented dummy keys: wrong action, invalid token and spent token rejected. Real widget credentials/host/action and browser challenges are not certified by this check. The script never loads real credentials and is opt-in, separate from npm test.
- Lint, typecheck and production build checked locally. No dependencies added.

Run `node scripts/verify-local-http.mjs` only against the local server on 127.0.0.1:3111 with Supabase variables absent, after `npm run build` and `npm run start -- --hostname 127.0.0.1 --port 3111`. This negative HTTP check is not a hosted login test.

Run `node scripts/verify-turnstile-provider.mjs` for the free dummy-key provider check; this requires outbound network. Public test keys are synthesized in memory. They must never replace real deployment configuration.

## Still requires actual TEST access

No TEST server credentials or dedicated mailbox are available in this workspace. No real users were used. Hosted OTP delivery/verification, Supabase-issued JWT/cookies, production Turnstile widget host/action, authenticated HTTP session lifecycle, and multi-connection SQL/HTTP concurrency remain unverified. Previous remote TEST transactional SQL behavior/RLS verification passed, but does not replace these missing tests.

Use a dedicated controlled test mailbox and a localhost server configured securely for TEST project lndvnufmbuzdbinapvze. Verify all three Supabase variables belong to TEST before starting. Do not use Production fspszgqmwhwfoiitnerp or test real identities. Keep server credentials out of NEXT_PUBLIC_ variables and commands/logs. Use the real OTP flow; do not manufacture JWTs, disable RLS/Turnstile or bypass the provider to declare success. Use two isolated browser contexts and parallel requests for duplicate/conflicting FINALIZE; assert one run and a single increment in aggregates.

The Vercel connector remains forbidden for dknyteam. Preview/Production isolation and branch push behavior must be read from the authorized dashboard before publishing. Separately assigned variable scopes alone do not prove their values or an existing deployment's build configuration. NEXT_PUBLIC values are embedded at build time; check the exact deployed SHA as well as current settings.

## Migration and recovery gates

The original 15 pending migrations and their SHA256/order manifest are retained without edits. No new database migration is needed for these route/replay fixes. Never apply fixture SQL to Production. Rehearse the currently deployed app against the upgraded schema before promotion.

Before any public deployment or Production migration:

1. Record current good deployment ID/SHA, migration history, schema/ACLs and row counts. Keep awards/payments under human control; do not invoke their generation or payment functions.
2. Obtain a complete logical backup with PostgreSQL 17 tools through a privately configured, authorized read-only service connection. Example: `pg_dump --dbname=service=rtw-production-readonly --format=custom --file=production-before-launch.dump`. Do not put passwords or connection URLs in command lines. Ensure the role can read all required schemas; a partial dump is not an accepted backup. Include migration history and relevant public/auth data, plus grants/roles metadata without role passwords. Store outside Git with restricted access.
3. Check pg_dump exit status and checksum. `pg_restore --list production-before-launch.dump` is an inventory check, not proof of recovery. Restore into a disposable LOCAL PostgreSQL 17 database and validate row counts, data, grants and schema. Hosted Supabase Auth/managed roles need a documented platform-compatible restore procedure; a local pg_dump alone does not certify that recovery path. Do not buy backup/PITR services or change plans without authorization.
4. Do not proceed until restore is proven and the precise backup location/checksum and recovery steps are recorded. Existing PGlite migration failure rehearsal is not a backup of current Production.
5. Drain official sessions before promotion. Active v7 sessions from the older replay may carry checkpoint evidence computed with the former timing; do not rewrite their evidence. Let them finish or expire, and avoid mixed validator versions. Keep v6 compatibility.
6. Apply only approved pending files in manifest order, transaction/history per file. Stop on error and preserve earlier commits. Check schema/ACLs before enabling new code.
7. Prefer reverting the application to the recorded good deployment, only after proving its compatibility with the additive schema. Do not run automatic down migrations, erase runs, repair migration history or restore over live Production automatically. A restore needs a maintenance window and an explicit decision about post-backup data to avoid loss.

These gates are prepared, not executed. No claim of Production backup or completed hosted recovery is made.
