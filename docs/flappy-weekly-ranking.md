# FlappyRace weekly ranking: read-only staging

## Scope and audit
FlappyMini currently uses browser state, Math.random(), variable render time and client-only collision/scoring. It does not submit official sessions or scores. Authentication alone cannot make its results authoritative.

Race To Win has its own deterministic replay, server seeds, checkpoint proofs, live Auth checks, session ownership and transactional finalization. Its start endpoint hardcodes race-to-win and its replay versions are specific to that game. They must not be reused as if they validate Flappy.

## Implemented
- Dedicated fixed-game GET /api/flappy-race/leaderboard, current New York week, pages of 50.
- Existing restricted public leaderboard RPC supplies public usernames only. No direct profiles reads.
- Existing game_id-scoped daily_top_scores and weekly_tournament_totals retain best seven per day, weekly sum and descending individual-score tie break.
- Exact ties display pending review with no numeric rank or podium winner.
- Read-only UI on /games/flappy-race; shared responsive three columns and gold/silver/bronze transparency.
- All current games explicitly identified as practice.
- POST on the ranking route rejects every submission, including duplicates, before parsing a body or touching storage. Other unsupported mutation methods receive Next.js 405.
- No registration of a game, database mutation, payout generation, EXTRA LIFE changes or Race To Win endpoint changes.

## Database and migrations
No migration is needed for this read-only stage. Existing tables are game-scoped; browser roles have RLS and revoked access in the versioned foundation. An absent or paused flappy-race catalogue entry returns an empty ranking; query/configuration failures return 503, not invented scores. Production RLS and deployed migration state have not been audited by executing SQL.

## Required before competitive activation
Official submissions remain hard-disabled in code. The competitive tournament is NOT operational yet.
A future reviewed implementation must supply versioned deterministic Flappy simulation, server-issued game-specific sessions and unpredictable seeds, bounded input evidence, server recomputation of collision/score, timing/liveness checks, live authenticated ownership, atomic idempotent finalization, shared persistent quotas, appropriate bot/abuse controls and database write constraints. No environment toggle can safely replace this work.
Register Flappy only after reviewing the generic catalogue/start/prize RPC effects. Do not apply production migrations or enable prize rules as part of this stage. Never backfill browser practice scores as verified runs.

## Validation limits
Tests cover fixed game/week filters, pagination, exact-tie presentation, public-only names, inconsistent snapshots, disabled arbitrary and duplicate submissions, failure states and server-rendered UI. Existing New York/DST/pagination and Race To Win tests run alongside these. Source-contract checks of SQL are not database integration tests.
Desktop/mobile real-data podiums need verified Flappy data and authorized database fixtures; no sample scores are deployed. Full authoritative-play, real RLS and idempotent-write integration tests remain blocked by the deliberately absent writer.
