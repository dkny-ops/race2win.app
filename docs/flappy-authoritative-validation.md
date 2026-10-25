# FlappyRace authoritative infrastructure (flappy-v1)

> Foundation report for commit 78a92ef. For the latest production audit, safe EXTRA LIFE
> interface, read-only admin integration and migration approval plan, see
> [flappy-parity-audit.md](flappy-parity-audit.md). The status below describes that foundation stage.

## Status
Competition remains blocked in reviewed source code and independently in PostgreSQL. No environment variable can activate it. No production migration has been applied. No ads, EXTRA LIFE, automatic prizes, balances, wallets, payments or prize-admin changes.

## Audit and engine
Existing FlappyMini used browser Math.random(), variable requestAnimationFrame delta (capped at two frames), gravity 0.29, flap velocity -5.5, horizontal pipe movement 2.15 pixels/frame, 150px gap, 54px pipes, bird at x=82 with radius=13, 360x480 canvas and boundary y=13..444. Points increment when a pipe's right edge passes the bird.

Race To Win uses a different lane-based deterministic replay and its own protected sessions/checkpoint/financial triggers. Those engines and session tables remain untouched.

New engine: fixed 60Hz steps, integer hundredths of pixels, server cryptographic uint32 seed and reproducible LCG obstacles, version flappy-v1. Values above remain unchanged. Technical differences: subpixel quantization to hundredths, fixed time rather than display-dependent physics, input debounce of four ticks, maximum 36,000 ticks/ten minutes and 6,000 flaps. Seed is NOT a secret or a proof of human play.

The canvas renders the exact same pure simulation used by server replay. Practice seeds are local, never official. PC Space and pointer/touch controls remain. Official state is never inferred from browser score.

## Endpoints
POST /api/flappy-race/sessions/start accepts exactly an empty object after live authentication, same-origin checks and persistent quota. Database creates UUID, binds authenticated owner and game catalogue ID, fixes engine/seed/start time (three-second countdown), ten-minute expiry and initial activity lease.
POST /api/flappy-race/sessions/checkpoint accepts exactly sessionId, throughTick, inputs (integer flap ticks). Full prefix evidence is capped at 48KiB/6,000 inputs, strictly increasing with four-tick minimum spacing. Server replays and independently caps simulation time by its clock.
POST /api/flappy-race/sessions/finalize accepts the same evidence, never score/seed/obstacles/player/version. Requires an independently reproduced collision. Server score/tick alone enter the transactional persistence RPC.

All mutation routes require live verified identity. Code gate currently returns 403 after identity validation. Origin/cross-site violations are rejected. Errors omit SQL/provider details. Logs contain only server-selected event/reason/status and random request ID, never input vectors or user credentials.

## Persistence and concurrency
Proposed additive migration: 20261025221423_flappy_authoritative_sessions.sql, generated with Supabase CLI.
Four private RLS tables: flappy_control, flappy_sessions, flappy_runs, flappy_quotas. Browser roles have no table access or function EXECUTE. Service role also has NO direct table access, only exact RPC grants. Functions pin empty search_path and reference schema-qualified objects. SECURITY DEFINER is necessary for restricted game/name lookups; RPCs are service-role-only. No schema or grants are broadened.

Sessions: active -> finalized, or active -> expired on subsequent start. One active session per player enforced by unique partial index plus serialized starts. At most five starts per rolling hour; atomic minute quotas allow six start attempts and thirty checkpoint/finalize requests per action. Lease renewals require progress and expire after fifteen seconds. Full run max ten minutes. No-progress exact checkpoint retries do not extend leases.

Evidence writes lock the session and compare expected tick, immutable input prefix and timing. Concurrent finalization writes one unique run; an identical retry returns the canonical outcome, changed evidence conflicts. Run insert and session update share one transaction; any failure rolls back both. Database recomputes New York completion day/week from authoritative start and collision tick.

Flappy uses its own private sessions/results to avoid expanding Race To Win's game/version constraints, checkpoints and prize-generating trigger surface. It reuses the trusted games catalogue, public usernames, New York tournament semantics and admin membership. It deliberately does not insert into shared validated_runs, which reference Race To Win-specific sessions and feed financial/referral triggers.

## Ranking and human review
Every physically verified run initially has verification=replay_verified and eligibility=under_review. None count toward ranking until separately reviewed. flappy_review_run is service-role-only and checks an active private.admin_users actor; no new browser review endpoint or prize-panel modification exists.
flappy_read_ranking exposes only public usernames, weekly scores, rank and exact-tie status. It sums seven best valid scores per day, compares all valid individual scores descending and leaves absolute ties without numeric/podium winners. One row per player; no public player IDs or private profile fields.
The existing ranking keeps its prior read-only path while the source activation gate is closed. Activating the new reader requires a reviewed code change as well, not an environment toggle. Public names mean existing player-chosen profile usernames, never legal/private names.

## Bots and known limitations
A valid replay proves consistency with flappy-v1, NOT that a human played. The seed and deterministic obstacles can be used by an automated controller. Minimum input spacing, persistent quotas, short leases and immutable checkpoint prefixes limit abuse but do not solve bots or compromised browsers.
All results default to manual antifraud review. No automatic claims of humanness, promotion to valid, or prizes. Before opening competition: evaluate adversarial bot controllers and require an approved human-verification/risk policy; review evidence-retention and operational monitoring. Human checks beyond current review policy are not implemented.
Long sessions replay their bounded prefix every checkpoint; worst-case cost must be measured under expected concurrency before activation. Precision, input debounce and duration caps require gameplay sign-off.
No public deployment can test live official play while both gates remain closed. Real PostgreSQL tests activate ONLY their disposable database through privileged fixture setup. Client rendering tests use practice; no fake production scores.

## Validation commands
npm run typecheck
npm test
npm run build
node tests/integration/flappy-postgres.mjs
node supabase/verification/fresh-install.mjs work/fresh-verification

The integration harness refuses arbitrary hosts/ports; it targets PostgreSQL on 127.0.0.1:55439 inside an isolated remote sandbox, creates and drops only its disposable test database, applies all migrations and exercises real roles, concurrent requests, rollback, score aggregation and idempotence. No mock PostgreSQL engine or SQL-text-only assertion substitutes for these tests.

## Exact activation conditions
1. Review test results, full immutable diff and remaining gameplay/bot risks.
2. Explicitly approve applying the additive migration to the intended Supabase project; back up and verify its existing migration state first.
3. Register flappy-race in the existing games catalogue only after verifying generic game/prize RPC exposure; no prize rules may be enabled. Migration intentionally does not register it.
4. Review and implement an operational antifraud process for promoting under-review runs, with independently verified administrator identity and audit trail.
5. Approve PC/mobile official-play end-to-end tests in a non-production database with both gates temporarily enabled, including clock/network failures and load tests.
6. Approve reviewed source changes to the client/server and ranking activation gates, then separately enable private.flappy_control with an audited database operation. Do not tie activation to environment configuration.
7. Keep prize/EXTRA LIFE features disabled independently.

Rollback is to close both gates and retain session/evidence history. Dropping tables is destructive, not an automatic rollback.

## Validation record
- Typecheck and production build: PASS in the isolated sandbox.
- Existing application suite plus initial Flappy tests: 84/84 passed; adversarial bot-replay test added for the final run.
- Real PostgreSQL 17.11 integration: 14 groups passed, including accidental SELECT grants still denied by RLS, 40 concurrent quota consumers, concurrent starts/finalization, changed evidence, future time, foreign owners, prefix integrity and forced transaction failure.
- Known baseline issue: the historical fresh-install behavioral suite fails with "Hourly official opportunities exhausted" in supabase/verification/migration-behavior.sql:90. The same failure was reproduced with the new Flappy migration excluded. Its fixture exceeds the later five-per-hour Race To Win quota. Existing Race To Win code and that fixture are not changed in this patch. This is a remaining full-suite limitation, not a Flappy migration failure.
- An adversarial automated controller produced 33 pipe passes in 3,000 simulation ticks for seed 0 and a valid replay. This confirms the bot risk concretely; all such runs still require manual antifraud review, and competition remains closed.

## Changed files
- lib/game/flappy/engine.ts — shared deterministic simulation and evidence validation.
- lib/game/flappy/activation.ts — reviewed default-off source gate.
- lib/game/flappy/server.ts — authenticated request handlers and replay verification.
- lib/game/flappy/official-client.ts — evidence-only browser transport.
- app/api/flappy-race/sessions/{start,checkpoint,finalize}/route.ts — fixed server entry points.
- components/game/flappy-verified-canvas.tsx — fixed-step canvas, desktop/mobile input, practice and gated official states.
- components/game/flappy-race-page.tsx — connects the canvas.
- lib/competition/flappy-ranking.ts — gated reviewed-run reader, preserving the closed-stage path.
- supabase/migrations/20261025221423_flappy_authoritative_sessions.sql — additive closed database infrastructure.
- tests/flappy-engine.test.mjs — replay, evidence, activation, authority and bot-risk tests.
- tests/integration/flappy-postgres.mjs — real PostgreSQL behavioral integration tests.
- docs/flappy-authoritative-validation.md — architecture, audit, limitations, validation and activation conditions.

Final application suite: 85/85 tests passed, no skips. Browser practice smoke test and screenshots at 1280x900 and 390x844: canvas, countdown, game over, public ranking and no horizontal overflow checked. Full official-play browser E2E with live Auth and an enabled non-production database remains an activation prerequisite.
