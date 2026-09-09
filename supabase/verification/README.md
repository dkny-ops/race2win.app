# Forward-only TEST upgrade — 2026-09-09

Target: **racetowin.app / lndvnufmbuzdbinapvze / Free**. Baseline Git: `68756bec082b9120c603ee5abd7b6da19b732e57`.
This procedure is specific to that TEST project. It does not authorize production, branches, paid resources, or pushes.

## Existing installation

Do not run `supabase db push`, migration repair, db reset, or modify/delete historical history rows.
The seven legacy local versions differ from their remote versions. They are **baseline entries, not pending migrations**.
The mapping and normalized SQL SHA-256 checksums are in `upgrade-manifest.json`. Historical profiles differ only in comments/format; historical Share SQL lacks later hotfixes. No exact historical Share source was found in Git, so it was not guessed or rewritten.

The only new migration is:
`supabase/migrations/20260909135938_converge_test_migration_state.sql`.
It was applied to TEST as **20260909185036 / converge_test_migration_state**.
Its recorded SQL matches the local file after LF/outer-whitespace normalization.

1. Run `node supabase/verification/check-upgrade-artifacts.mjs`. A checksum failure stops the procedure.
2. Explicitly select project `lndvnufmbuzdbinapvze` and verify its organization remains Free.
3. Read `supabase_migrations.schema_migrations` in version order. If the convergence migration exists, run the entire `upgrade-postflight.sql` through Supabase execute_sql. Success means **already installed: skip application**. A mismatch requires investigation; never create a duplicate record.
4. Only when absent, run the entire `upgrade-preflight.sql` through execute_sql. It checks fingerprints of both the exact seven-entry history (including recorded SQL) and the complete captured application catalog. Any mismatch stops the upgrade.
5. After a successful preflight, apply **only** the exact new SQL file via Supabase apply_migration, with `project_id=lndvnufmbuzdbinapvze` and `name=converge_test_migration_state`. This API may assign a remote timestamp different from the local filename. Record the returned/observed remote version; never rewrite the old versions to match local filenames. The present postflight pins the actual TEST version above.
6. Run `upgrade-postflight.sql`, `migration-behavior.sql`, and `catalog.sql`. Archive the complete outputs. The behavior script wraps fixtures in a transaction and rolls back; it neither disables RLS/triggers nor retains users, prizes or ledger entries.
7. Compare the catalog snapshot to a fresh local installation with `node supabase/verification/compare-catalog.mjs <fresh-catalog.json> <remote-catalog.json>`. Nonzero exit means STOP.

Preflight and postflight are separate read-only checks. The migration itself is transactionally applied with lock/statement timeouts and an advisory lock. Schedule a single deployment operator; these checks do not lock out unrelated manual DDL. If state changes between checks, investigate instead of bypassing the guards.

Once this upgrade is installed, future changes must be new, explicitly selected migrations with a new manifest/preflight/postflight. Do not append changes to this now-applied file. Do not infer “pending” solely from unmatched legacy filenames.

## Fresh local installation

Use a dedicated disposable PostgreSQL 17 cluster bound only to **127.0.0.1:55439**, initialized with a local postgres administrator. This is native PostgreSQL, not a billed Supabase resource. Never point it at a remote host or a shared production database.

Set `PSQL_BIN` to the installed psql executable, then run:

```text
node supabase/verification/fresh-install.mjs <absolute-evidence-directory>
```

The runner allows only that loopback host/port, creates a uniquely named disposable database, applies the small Auth/role scaffold, then every local migration in filename order in individual transactions. It captures the catalog and executes the same rollback behavior checks, and drops its disposable database in a finally block. It needs administrator privileges only on that isolated cluster.

The Auth scaffold represents the auth.users/auth.sessions fields and JWT SQL helpers required by these migrations. It is **not GoTrue and does not prove JWT signature validation**; that was a separate real TEST integration task. Platform-owned Auth internals and platform-wide default privileges are outside the application-catalog equality claim. Application functions, indexes, triggers, columns, constraints, policies, RLS and effective table/column grants are compared.

Comparison ignores physical database-name metadata and normalizes comments/whitespace. The captured object definitions and functional tests supplement this logical comparison. Outputs contain schema definitions, not service_role credentials.

## What the correction does

- Records canonical Share reconciliation with nullif-protected divisors, idempotent generation and the unique weekly tournament award index.
- Removes excess service_role table privileges inherited from platform defaults, including TRUNCATE, REFERENCES and TRIGGER. Restores the explicit application runtime allowlist and ledger UPDATE(id) required for row locks; row mutation remains denied.
- Grants service_role the missing private.weekly_share_prize_pool_cents helper used by invoker Share/finalize calculations. Public RPCs remain unavailable to browser roles.
- Leaves the confirmed Share date/week, ledger debit/append-only guards and live-profile-session policy intact.

Do not grant schema CREATE or expose service_role in a client to work around a failed check.

Reference: [Supabase database migration guidance](https://supabase.com/docs/guides/deployment/database-migrations).

