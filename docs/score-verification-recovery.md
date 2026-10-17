# Recover held weekly scores

Read-only inspection of production project `lndvnufmbuzdbinapvze` on 2026-10-17, based on main `b057124`:

- Week 2026-10-12 has eight valid runs on October 15: 1607, 928, 923, 874, 348, 333, 319, 134. The seven best sum to **5332**. Excluding 134 is correct.
- The October 17 runs of 11 and 13 points are `under_review`, with session and observation assessment `verified` and no automation signals. Each has a `weekly_leadership` human-verification record whose effective status is expired.
- `weekly_tournament_totals.calculated_at` was 2026-10-17 15:25:53.669043 UTC, matching the second new run. The trigger rebuilt the week, excluding held runs as designed.
- The actual production leadership trigger requests verification whenever the first-place player lacks a verified weekly leadership record. Being the existing leader does not exempt the player.
- Production provides read, restart and verify RPCs for the challenge, restricted to `service_role`. Main lacked the route and UI to use them.
- Across all weeks, recomputation found only two missing totals in synthetic week 2099-02-09. No discrepancy was found for the affected current week. Future fixture data was not changed.

## Change

The authenticated personal scores response now exposes up to 50 current-week pending runs for its owner. `/scores` explains their exclusion and presents a human-verification widget when the server permits it. Expired challenges have an explicit restart button; no restart or approval runs automatically. Successful verification refreshes both personal and world scores using the existing refresh listeners.

The new route derives the player from the live authenticated session, requires same-origin POST requests, bounds request parsing, checks the existing owner-scoped challenge, and validates Turnstile action and hostname before invoking the existing verify RPC. Provider/configuration failures keep the result pending. Fraud review is not cleared by this route.

The unapplied `20261017120000_post_finalize_refresh_week.sql` is removed. Production migration history confirms it was never applied. There is no need to add another ranking refresh: the existing synchronous trigger already ran. Its target routine can also reconcile stale winners, so it must not be called as a supposedly harmless diagnostic.

The restored finalize route from b057124 is unchanged. A pre-existing failed wording assertion in the game client is fixed by restoring the expected failure wording.

## Release prerequisites and verification

1. Review the patch. The production leadership-verification migration exists as version `20261016145008`; main is missing multiple production migrations. Do not blindly push, reset or replay the migration directory against production. This change requires no production SQL application. Provisioning a fresh environment requires a separate reconciliation of existing schema history.
2. Preserve existing Turnstile keys, allowed hostnames, enforcement setting, and allowed actions. Add `weekly_leader_verification` to `TURNSTILE_ENABLED_ACTIONS`. The widget fails closed if unavailable. Production configuration was not read or changed during this work.
3. Deploy the application change after review. No deployment was performed in this task.
4. The player opens `/scores`, restarts an expired challenge, completes the displayed challenge, and explicitly submits verification. This is a real data mutation and was not performed during diagnosis. Both current held runs would add 24 points if legitimately verified, producing 5356 while other results remain unchanged.
5. Re-run `supabase/verification/score-materialization-readonly.sql`. Confirm the verified run becomes eligible and both score panels refresh. No production browser session or live token completion was tested here.

Validation: 53 tests passed, TypeScript, ESLint, production build, and whitespace checks passed. New behavioral tests cover cross-origin and unauthenticated denial, provider rejection/unavailability, owner scoping, expired challenge renewal, duplicate approval denial, and pending score query boundaries. Production inspection used only reads. No refresh, restart, approval, migration application, prize modification, or result update was executed.

The dependency installation reported nine pre-existing dependency advisories (eight high, one critical); dependencies and lockfile were not changed by this scoped fix.
