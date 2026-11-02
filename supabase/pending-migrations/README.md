# Owner-authorized migrations pending application

SQL in this directory is prepared and tested but **not applied**. It is deliberately outside `supabase/migrations` so publishing code cannot automatically apply a financial-function change. Do not add this directory to deployment scripts or auto-run it.

`20261102004207_fix_flappy_prize_allocation_transition.sql` was generated with `supabase migration new`, then staged here pending the owner's explicit Production authorization. It replaces only the Flappy allocation function, preserves the shared winner guard and all grants, and performs no award, balance, ledger or payout data updates.

After explicit authorization, review the exact SQL and its checksums, re-run its read-only preflight against the intended project, and apply only this migration in one transaction through the normal migration mechanism. Verify the recorded SQL, function/grant fingerprints and unchanged financial row digests afterwards. Use the actual recorded version when promoting the file into the active migration directory; do not repair or replay old history.

The existing 101 active migrations remain matched to Production. See `docs/flappy-prize-allocation-audit.md` for the cause, verification and limitations.
