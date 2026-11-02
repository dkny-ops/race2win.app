# Production migration provenance unified

Completed on November 1, 2026 (America/New_York). Database: `lndvnufmbuzdbinapvze`.

`supabase/migrations` now follows the **100 versions actually recorded in the application database**, followed by `20261102002233_reconcile_production_provenance.sql`. The marker was applied through the normal migration mechanism and its recorded SQL was compared with the source. No old migration-history rows were inserted, removed, repaired or renumbered.

The 37 former source files remain byte-for-byte available in `supabase/archive/pre-unification-20261101`, with their original Git blob IDs in the manifest. The archive is not a migration directory. Files that had different timestamps or were never registered must not be replayed against Production. In particular, do not replay the historical 1500-cent prize definition.

## What the marker changes

Only its own migration-history entry. Its SQL takes a transaction-scoped advisory lock and verifies 126 application-function definitions and grants; the complete application table, column, index, policy, trigger, constraint, RLS and grant fingerprints; enabled Flappy Turnstile; and the already-live financial invariants. It creates or replaces no application objects, changes no grants and writes no player, winner, balance, ledger or payout rows.

The before/after counts remained 12 balances, 29 ledger entries, 39 winners and 9 payouts. The other Supabase project, `fspszgqmwhwfoiitnerp`, was not migrated. No game rules, prize amounts, withdrawal thresholds, tournament activation, Vercel resources or payment automation were changed.

## Why the reconstruction includes a provenance overlay

The recorded history alone is incomplete as a description of the live schema. Native reconstruction found two unrecorded support tables (`winner_contact_closures` and `winner_owner_verifications`), four unrecorded owner-contact/verification functions, already-live prize/withdrawal and Flappy test-account definitions, and several existing service-role grants. The exact observed definitions and grants are preserved as **local-only reconstruction inputs** in `supabase/verification/production-provenance`. Those inputs are never a production migration and must never be submitted as one.

This separates recorded history from observed runtime state without fabricating old execution records. Future changes must be new, explicitly selected forward migrations. Never use `migration repair`, `db reset`, mass history edits, or `db push --include-all` to force this installation into a different history.

## Verification

The dedicated `production-provenance/verify.cjs` runner creates a new disposable PostgreSQL 17 cluster and uses its native single-user backend without opening a network socket. Set `POSTGRES_BIN` to the directory containing `initdb` and `postgres`, then run:

```text
node supabase/verification/production-provenance/verify.cjs <new-local-evidence-directory>
```

It verifies SQL checksums, replays the 100 registered migrations, supplies explicitly documented synthetic historical prerequisites, reproduces the already-live runtime overlay locally, and tests the assertion-only marker twice. A sentinel hashes every row of every application table before and after both executions. Financial fixtures verify 500/300/200-cent allocation of already-reviewed awards, rejection before candidate approval, the 2000-cent payout minimum, aggregation of credits from both games, and retry idempotency. All fixtures roll back. The marker checks the complete catalog against the live baseline.

The manifest records the SQL checksums, original-source blob IDs, function and structural fingerprints, verification results, and limitations. The older TEST-specific verification scripts remain historical tools for their original baseline; use this runner for the unified production history.

### Limits and a pre-existing allocation defect

Auth is a minimal SQL scaffold, not GoTrue. `pg_cron` is represented by a local metadata scaffold because Windows PostgreSQL does not ship it; background scheduling was not exercised. Concurrency was not tested in single-user mode. These limits do not certify the games or payment systems; this change only records and preserves their existing state.

A separate existing defect was reproduced: `flappy_admin_allocate_prize` creates a new provisional award and attempts a direct `provisional -> verified` transition, while `protect_provisional_winner` requires an intervening claim/review state. That fresh-allocation path raises SQLSTATE 23514. The successful credit fixtures use already-verified awards, explicitly testing that branch rather than concealing or weakening the guard. This unification preserves the existing function and does not fix that financial behavior.
