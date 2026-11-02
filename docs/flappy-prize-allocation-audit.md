# Flappy prize allocation: pre-patch investigation

Baseline: `161a1277e5ea54fb6f5eddfbb2c75761341d128e` (`main`). This audit was recorded before editing the allocation implementation.

## Reproduced cause

On native PostgreSQL 17.11, using only synthetic identities in an isolated database reconstructed from the unified history and its documented runtime overlay, an active administrator approved a frozen Flappy prize candidate and called `public.flappy_admin_allocate_prize(uuid,date,uuid,text)` for a player with no existing award.

The function inserted an `allocated`, `provisional` winner and then called `rtw_admin_transition_winner(...,'verified',...)`. The `provisional_winners_guard` trigger invokes `private.protect_provisional_winner()`, which rejects a direct `provisional -> verified` transition with SQLSTATE `23514`, message `Invalid provisional winner state transition.`. Valid intermediate states already include `under_review` and `claim_started`. The exception rolls back the award and credit completely. The baseline reproducer verified that neither a provisional winner nor ledger credit remained.

This is a mismatch between the Flappy allocation caller and the shared, correctly restrictive state machine. It is not an RLS/permission error and was not introduced by the unification, which preserved the function and trigger definitions. The existing-verified-winner branch bypasses the broken transition and succeeds, explaining the narrower successful tests documented during unification.

## Request and authority boundary

- `app/api/admin/flappy-race/prizes/route.ts`: same-origin POST; rejects cross-site requests; bounded JSON; exactly four validated fields (`week`, `playerId`, `action`, `note`); actor ID comes from the verified server context, never from the request. Amount and rank are calculated by SQL, not accepted from the browser.
- `lib/security/prize-admin.ts`: verified Auth identity, confirmed configured owner email and active database-admin check. The privileged Supabase client is server-only (`lib/supabase/admin.ts`).
- Allocation RPC: active `private.admin_users` actor, Monday week, enabled prize program and inaugural-week guard, frozen effective top-three candidate, explicit approved candidate state, per-week transaction advisory lock, existing-award row lock, amount/rank conflict checks, and early idempotent return for already-approved credit.
- `public.flappy_decide_prize_candidate`: separately records human candidate approval/rejection and its actor/note before financial credit approval. Allocation records `financial_credit_approved` in `private.flappy_prize_winner_case_events`.
- `public.rtw_admin_transition_winner`: rechecks admin authority and uses the shared trigger; credit insertion has a unique per-winner partial index. `private.apply_prize_ledger_entry` maintains nonnegative balances.
- Existing payment authorization remains separate. Allocation returns `paymentsEnabled:false`; no payout creation or paid transition is performed by this path.

At the initial audit baseline the legacy Flappy review page returned `notFound()`; `/admin/flappy-race` already used the authoritative prize-case reader and `FlappyPrizeCaseControls`. This was independent of the reproducible SQL failure. Later concurrent commits restored the other owner panel; that caller was reviewed separately below rather than overwritten.

## Relevant storage and privileges

Frozen inputs and decision history: `private.flappy_prize_program`, `flappy_prize_period_results`, `flappy_prize_winner_cases`, `flappy_prize_winner_case_events`; candidates are derived through `private.flappy_prize_effective_candidates`.

Financial outputs: `public.provisional_winners`, `prize_ledger_entries`, `prize_balances`; payments remain in `payouts`/`payout_credit_allocations`. RLS remains enabled and browser roles have no allocation-RPC execution or direct financial-write privileges. Relevant uniqueness includes the award's game/week/type/player key and `prize_ledger_one_credit_per_winner_idx`.

## Minimal correction boundary

Correct only `flappy_admin_allocate_prize` so its already-approved, provisional award follows the existing authorized `provisional -> under_review -> verified -> approved_for_payment` path within the same transaction. Preserve the shared trigger, all current award amounts (500/300/200), candidate gates, locks, conflict checks, idempotent return, immutable paid/previous allocations, grants, RLS, audit insert and separate manual payment authorization.

A new guarded forward migration is required; no applied migration will be edited. It must not be applied to Production without the owner's explicit authorization. Concurrent tests will use independent connections to local PostgreSQL via a filesystem socket, not production.

## Endpoint addendum: independently reproduced before changing the route

Executable tests of the actual transpiled POST handler exposed a second independent defect: its UUID expression ended after the fourth group (`8-4-4-4`), omitting the final `-12` hexadecimal group. A valid 36-character player UUID was rejected with HTTP 400 before any RPC; a 23-character truncated identifier matched the faulty expression. Existing tests inspected route source but did not execute this legitimate allocation request.

The route correction only adds the missing final group, retaining version 1–5 and RFC variant validation, same-origin checks, owner/admin authorization, body limits and the exact field allowlist. Regression tests require a canonical UUID to reach the RPC using the verified server actor and require a truncated UUID to be rejected without any RPC. Neither this format correction nor the SQL state-path correction changes award amounts or enables automatic payments. Both defects predate the unification.

## Current-main panel addendum, before changing its state binding

During this work `main` advanced to `465c6a39cb6720419b9afbbcd85902a8b233fb90`, restoring the owner panel at `/admin/prize-review/flappy-race`. Its new `FlappyPrizeControls` enables credit review only for `status==='approved'`, but the server page supplied `provisional_winners.status` (or `pending`). The financial winner state machine has no `approved` state: candidate approval belongs to `private.flappy_prize_winner_cases`. Therefore a correctly approved candidate without an existing financial award could never enable this button.

An executable test of that exact server page reproduced the wrong `pending` property for an approved candidate. The minimal page correction reads the already-existing, owner-scoped `flappy_admin_read_prize_cases` RPC and binds the eligible candidate's state, without changing the displayed winner status, ranking queries, award rules, payment controls or client authority. Failed reads and disabled programs remain fail-closed. Concurrent UI, branding, player lookup, audio and course changes are preserved and are not part of this patch.

## Candidate correction and verification

The production-function candidate differs only by adding the authorized `under_review` transition before its existing verification call. The migration preflight pins both accepted versions of that function, the unchanged shared winner guard, the administrative transition function and the exact service-only ACL. Reapplication is safe; any unrecognized definition or grants stop the migration. The original award amounts, candidate checks, per-week transaction lock, row lock, immutable-allocation checks, idempotent return and audit event remain intact.

The SQL is staged at `supabase/pending-migrations/20261102004207_fix_flappy_prize_allocation_transition.sql`. It was created by the Supabase CLI and then moved outside the active directory to prevent automatic application before the owner's explicit authorization. None of the 101 applied migrations or the 37 archived source files was edited.

Verification commands:

```text
npm test
npm run typecheck
npm run build -- --webpack
node tests/integration/flappy-prize-allocation-postgres.mjs
```

For the PostgreSQL suite, set `LOCAL_PG_SOCKET_DIR` to the local server's filesystem socket directory and `PSQL_BIN` to native PostgreSQL 17 `psql`. The suite accepts no TCP host, requires the server's TCP listener to be disabled and creates/drops its own disposable database by cloning the baseline produced by `supabase/verification/production-provenance/verify.cjs`. Start that baseline cluster on socket port 55439. No remote credentials are used. The minimal Auth and scheduler scaffolds retain the baseline's documented limitations.

The integration suite reproduces the original SQLSTATE 23514 before the patch, applies the staged SQL twice, checks that only the allocation function changes, and compares every financial row and all structural fingerprints before/after application. It then verifies fresh $5/$3/$2 allocations, audit preservation, idempotent retries, actual role-based denial for `anon`/`authenticated`, non-admin and inactive-admin rejection, unapproved/off-podium rejection, unchanged paid history, ledger-owned nonnegative balances, unchanged Race review/credit behavior and the existing $20 withdrawal floor.

Concurrency uses independent PostgreSQL connections. The first transaction retains its advisory lock after allocation; the suite observes the second waiting on that lock before the first commits. Both calls finish with one award, one ledger credit, one balance increment and one financial audit event. This is not a single-user or mocked concurrency test.

Production was inspected only with read-only queries. Before/after counts and complete-row digests for balances, ledger, winners and payouts matched: 12, 29, 39 and 9 respectively. The production allocation definition remains the original fingerprint `996ba05840edc830224ead1606ccc314`, proving that the staged financial correction has not been applied. RLS is enabled on all eight inspected financial/prize tables, no browser policies are defined for them, and the allocation RPC remains unavailable to `anon` and `authenticated` while retaining service-role execution.

No new bypass was identified in the changed validation and state-transition paths under the performed tests. This is a scoped correction, not a repository-wide security certification. Auth identity/provider integration is represented by unit-test substitutes; actual database grants, RLS, triggers, ledger behavior and transaction locking are tested on native PostgreSQL. Background scheduling and external payment providers are outside this patch and were not invoked.

Final checks on the reconciled `465c6a3` source plus this candidate: **134/134 unit/regression tests PASS**, **8/8 native PostgreSQL groups PASS**, TypeScript PASS, production webpack build PASS, and ESLint of all changed source/test files PASS. Repository-wide lint was also run and remains failing with 26 pre-existing errors and 5 warnings outside this correction; it is not reported as passing. The initial dependency junction was incomplete; final checks use an existing complete dependency installation whose Next, TypeScript, React and Supabase versions match the lockfile. No dependency or lockfile was changed.

The pre-publication review traced both UI callers to the same owner-gated endpoint, checked that the page adds only a read-only administrative RPC, confirmed the valid/invalid UUID cases, and inspected all allocation branches: new provisional, already verified, already credited, conflicting amount/rank and paid/terminal awards. The shared state machine remains unchanged, and the existing early return prevents duplicate financial audit entries and credits. The pending SQL's checksum and the production before/after digest evidence are included in the delivery artifacts.

The endpoint format correction can be deployed as code. Full fresh-allocation recovery in Production remains pending explicit owner authorization to apply the staged SQL. It must not be described as active there until postflight verification succeeds. No migration, award, balance change, payment or automatic payment activation was performed in Production during this work.
