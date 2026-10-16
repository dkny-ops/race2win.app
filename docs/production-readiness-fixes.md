# Production readiness corrections

Branch: fix/production-readiness-20261010, based on PR #1 e170955. No Production writes, deploy, push or merge are part of this preparation.

## OTP admission

The request endpoint emits an HttpOnly/SameSite=Lax/Secure-in-production challenge only after the existing request limiter and Auth provider accept the request. Its HMAC uses the existing server-only RTW_ABUSE_HMAC_KEY with a separate purpose, normalized email, issuance timestamp and random nonce. The verify endpoint checks it before consuming shared verify capacity or calling Auth. Missing, altered, mismatched, future or expired challenges fail closed with the existing generic error. This proof admits verification; only Supabase verifies the OTP and authenticates the user. Existing DB/email/global limits still apply.

It expires after ten minutes, allows bounded retries under the existing limiter, and is cleared on successful verification. It is not a DB-backed single-use token. Previously requested codes without the new cookie need a new request after deployment. Key rotation invalidates pending challenges; coordinate deployment replicas and request a new code. Direct requests to Supabase Auth and external WAF controls remain a separate configuration gate.

## Turnstile

Script.onReady restores initialization after navigation remount; cleanup resets the widget ID for effect remounts. The page requires otp_request in the server action allowlist. Incomplete enabled configuration remains closed. No claim/payment boundary changed.

## Dependencies

Pin Next and eslint-config-next 16.3.8. Override Sharp 0.35.5 and source-map-js 1.2.2; lock compatible brace-expansion updates. Node >=22. PGlite 0.3.14 is development-only for PostgreSQL 17.5 rehearsal. Runtime npm audit is clean; five high advisories remain in the development-only ESLint→fast-glob→micromatch→braces chain, with no compatible published fix found by npm audit. Do not force downgrade ESLint/Next tooling to 14.2.35. Build/lint inputs must remain trusted; document an exception or review a future compatible patch before release.

## Rehearsal

Run npm run test:db. No connection string or network is used: two disposable in-memory PostgreSQL databases are created. The bootstrap supplies minimal auth tables/JWT functions and anon/authenticated/service_role roles. Fresh install runs 24 migrations; upgrade runs 9, seeds synthetic existing v6 history/profile, then runs the original 15 pending files. Failure injection inside the migration transaction tests initial and final failures, history rollback, preservation of earlier commits and safe retry. SQL verifies ownership, leases/checkpoints, expired FINALIZE, Top7, weekly totals, all-run tie vectors, exact ties, DST, projections, RLS/session revocation, ACL/search_path and OTP limits. Real FINALIZE route/parser/replay is bridged to real SQL; Auth identity/network transport is simulated.

No award generation, claim, payment or payout function is invoked. Their table counts remain zero. Historical migration files are unchanged. production-pending-manifest.json records order and SHA256 for the 15 files; compare its baseline with fresh read-only Production history before any future application. No migration runner for Production is supplied.

Limitations: PostgreSQL 17.5 WASM vs Production 17.6; one process/connection, minimal Auth schema rather than hosted Supabase. This does not test live SMTP/JWT/PostgREST, concurrent cross-instance advisory locks, Vercel limits, or the currently deployed app against the new schema. Complete those in a disposable hosted TEST environment before promotion. Vercel read configuration is blocked by 403 under dknyteam; no CLI credentials are available.

## Future release and rollback

Read/review all pending SQL and rehearse the actual currently good deployment against the upgraded schema. Do not assume the main Git hash is the deployment currently good. Obtain read access to Vercel and verify env targets, current deployment/SHA, runtime, WAF, duration and rollback ID. A branch push may automatically start a Vercel Preview deployment: review or disable that behavior before authorizing a push if deploys are still prohibited.

Future migration/publication requires separate authorization. Gate official traffic, drain sessions, repeat read-only baseline, and apply only the approved 15 files in order with transaction/history per file. Stop on failure; preserve earlier successful entries. Keep new code gated until the full schema and ACL checks pass. Never run local fixture SQL on Production. Promote only the tested deployment. Roll back to the actual good deployment tested with the additive schema; keep migrations/history. No SQL down/reset/repair, deletion of session history or automatic database restore. Payments, awards and competition rules remain out of scope.
