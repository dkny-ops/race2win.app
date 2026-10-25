# FlappyRace: audit, safe web delivery and production approval plan

Audit date: 2026-10-25 UTC. Base main: d4f928872cddb44c5808ac67e357ee59648affb4.
This extends the authoritative foundation in 78a92ef. It does not activate an official tournament.

## Comparison and evidence

“Code”, “isolated tests”, “database applied” and “live” are distinct.
Production was inspected read-only; no competitive runs, rewards, users, balances or migrations were written.

| Area | Race To Win actually observed | FlappyRace delivered / remaining |
|---|---|---|
| Identity | Shared Supabase SSR client calls auth.getUser; confirmed identity and profile rules; production OTP/admin infrastructure exists | Same verified identity for official routes; practice guest flow retained. Full signed-in OTP flow not exercised by this audit |
| Sessions | Versioned server START/checkpoint/finalize and persistent leases; production has historical v6–v20 support | Existing flappy-v1 server seed, 60 Hz integer engine, bounded inputs, owner/expiry/clock checks, leases and persistent quotas retained; isolated PG tested; production DB objects absent |
| Finalization | Authoritative replay and transactional verified results | Same-session exact retry idempotence, concurrent finalize/start and rollback tested; no browser score accepted |
| Weekly score | Existing shared daily top-seven/NY weekly aggregation and score-vector tie breaking | Independent game-scoped reader and private results; Monday–Sunday NY, daily seven, weekly up to 49; all verified individual scores form descending tie vector; absolute ties have no numeric podium |
| Ranking UI | Existing columns and responsive style | Existing Flappy reader/podium styling retained; honest empty results before activation, no fake entrants |
| EXTRA LIFE | Current scene displays COMING SOON and explicitly grants no local reward | Inspectable panel on page and Game Over; ad grant unavailable. Opening Game Over explanation pauses automatic dismissal. A private, single-session reservation ledger is proposed, not applied |
| Rewarded ads | Scene has disabled WATCH AD; opportunities API returns extraAdsAvailable:false. AdSense account metadata alone is not a verified provider integration | No simulated ads, browser callbacks, grant/consume endpoint or score changes. Ledger is preparation only, not a working reward system |
| 2X POINTS | Not found as an active approved feature in audited scene/server reward flow | Unavailable; not advertised as playable. Reservation schema accepts extra_life only and one slot/session; no multiplier path |
| Resume | RTW human-check five-second protection is not a rewarded extra life | v1 collision is terminal. Extra life needs separately reviewed versioned continuation protocol and provider verification, not a client reset |
| Administration | Existing confirmed-owner + live Auth + active-admin RPC guard; human prize review | New read-only /admin/prize-review/flappy-race uses exactly that guard. Pending RPC shows unavailable before migration. Shows player/session/time/score/version/tick/input count/digest/review status; detail independently replays server-side. Seeds and raw inputs are stripped from rendered output |
| Prizes / balance | Existing administrative ledger/payment mechanisms; current rules do not promise an active cash programme | No financial integration, payable balance, automatic winner, award or payment added; no RTW prize change |
| Bots / abuse | Human challenges and server controls exist, without proof all valid replay is human | Known greedy seed-aware bot still works. All official replay outcomes remain under_review; no bot-proof claim. No automatic review-approval UI |
| PC / mobile | Current RTW scene has keyboard/touch controls | Focus after PLAY and pointer focus corrected for SPACE. Touch/canvas layout retained; explanatory panel scrolls when needed |
| Disconnects | Existing fail-closed session controls | Official requests now bounded to 10 seconds; failures never yield an official score. No automatic START retry or local official fallback |

Source scope: current RTW scene/game/replay/types, auth server, opportunities API,
human-verification docs/API, admin/prize-review pages and guard; existing Flappy
engine/server/client/ranking/migration/tests; production catalog, migration history,
RLS and security advisors. This is not a repository-wide security certification.

## Principal production project verified

Vercel project race2win.app / prj_8GKiG18JWvmYExZIeyaqftoRdO6V points via its public
Supabase URL to **lndvnufmbuzdbinapvze** (racetowin.app), PostgreSQL 17.
The similarly named other project was not changed.

At inspection:
- No private.flappy_control, flappy_sessions, flappy_runs or Flappy RPCs exist.
- No flappy-race game catalogue entry exists. Existing unrelated test catalogue entries were not touched.
- Relevant shared game/session/score/ranking/prize/admin tables have RLS enabled.
- Production has additional auth, human-check, admin and version migrations absent from repository history.
  Do not replay the repository migration directory wholesale onto production.
- Supabase advisors report 39 INFO no-policy tables (often intentional deny-browser tables;
  grants and RPC access must be evaluated together), and a pre-existing WARN for disabled
  leaked-password protection. No Auth setting was changed.
  [Advisor remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Migration plan — approval required, NOT executed

Only these additive files are proposed, in this order:
1. 20261025221423_flappy_authoritative_sessions.sql: private control/sessions/runs/quotas;
   service-only RPCs; independent gate defaults false; all results under_review.
2. 20261025230720_flappy_admin_reward_preparation.sql: private non-granting single-slot
   reservation ledger and active-admin read RPC. No reward issuer/consumer exists.

Both use empty search_path on SECURITY DEFINER functions, revoke browser access,
enable RLS and deny direct service-role table privileges. Existing RTW function
definitions are unchanged in actual PG testing. Neither alters shared score/prize
tables/triggers, registers a game, changes Auth, enables a gate or creates a payment.
Schema application alone will not make official mode playable.

Preconditions and backup:
1. Reconfirm production ref and migration history immediately before execution; check object
   collisions and expected dependencies against live catalog.
2. Obtain a verified current Supabase backup/PITR restore point and record its timestamp,
   retention/access and recovery procedure; for portability, a protected schema+data export
   may be taken by the owner using privileged credentials outside browser/code/logs.
   **No backup or restore test was created/verified in this audit. This is a blocking precondition.**
3. Compare dependency signatures/roles/constraints with live production; specifically profiles,
   games, auth.users and private.admin_users. Review only these additive statements against
   the current live schema; isolated fresh-schema success does not certify all production drift.
4. Record counts/fingerprints of RTW sessions/results/awards/balances; keep both code gates closed.
5. Request explicit user authorization for these two files on lndvnufmbuzdbinapvze.
6. Apply each via the migration service transaction, one at a time, recording version/result.
   Verify RLS/grants/empty Flappy tables/false gate and unchanged RTW fingerprints/counts.
   No production write fixtures or gate activation are part of this approval.

Recovery:
- SQL failure rolls back the current migration transaction; stop and inspect.
- On app regression restore the prior Vercel deployment; keep Flappy competition closed.
- If schema applied successfully, retain additive tables/evidence and close its database gate.
  Do not drop tables or reset the project; any destructive cleanup requires separate approval.
- Backup/PITR recovery is last resort only, coordinated with the owner, because restoring a
  shared production database can discard intervening RTW transactions. Prefer a reviewed
  targeted forward correction for additive Flappy objects.

## Controlled official tests — separate approval, NOT executed

After approved schema application and bot/review policy work, propose a time-bounded,
server-only test using one owner-approved account and explicit allowlist. Keep public
official routes/code gates closed; no public game activation as a shortcut. Permit only
review-held evidence; never change a test result to valid, never call prize/payment RPCs,
and verify real public ranking/balances remain unchanged. Record exact session IDs and
audit results; expire test sessions afterward and retain evidence tagged in an approved
audit mechanism. A scoped test adapter/allowlist and its deployment need review before
this plan can run. No production identities or scores were fabricated in this delivery.

## Verification and known limits

Typecheck, production build and targeted ESLint: PASS. Automated suite: 90/90 PASS.
Real PostgreSQL: 16 integration groups PASS, including actual roles/RLS, concurrent
finalization/start/quota/reward-slot uniqueness, admin authorization and independent
replay of persisted detail. RTW non-Flappy function fingerprints unchanged.
Git diff whitespace validation: PASS. Browser/deployment results are recorded in the production verification section below.

Tests use a disposable Vercel Sandbox
under the principal project, real PostgreSQL 17.11, no production database credentials
and no local project checkout changes.

The historical fresh-install behavior harness fails at migration-behavior.sql:90 with
“Hourly official opportunities exhausted”. Its fixture creates too many sessions for
one player in the server clock hour. Reproduced with all Flappy migrations removed as
well as with the new files: baseline failure, not suppressed. Quotas, RLS and shared
triggers were not weakened. This remains a blocker to claiming the complete historical
migration suite passes or approving official launch.

Known residual risks/blockers: physically valid bots; no verified provider/SSV; no
reviewed deterministic resume protocol; unapplied schema; production migration drift;
unverified backup/recovery; no full signed-in official end-to-end test or production
load certification. A replay match means evidence consistency, not human play.

## Exact activation checklist

- [ ] Verify backup and recovery; approve and apply only the two named additive migrations.
- [ ] Reconcile live schema drift and resolve the historical behavior harness without weakening quotas.
- [ ] Review bot/risk policy and abuse/load evidence; retain suspicious runs under_review.
- [ ] Exercise owner-authorized signed-in session lifecycle and review end-to-end under controlled plan.
- [ ] Approve and audit a real rewarded provider proof flow with unique receipt verification,
      persistent atomic grant/consume and replay-versioned validated resume before EXTRA LIFE.
- [ ] Separately approve any 2X rules; do not infer approval from RTW placeholders.
- [ ] Review independent catalogue registration, opportunity policy and both activation gates.
- [ ] Separately approve competition launch. Prize configuration/awards/payments require
      their own human review and authorization; enabling gameplay never authorizes payment.

## Files in this delivery

- lib/game/flappy/rewards.ts
- components/game/flappy-reward-options.tsx
- supabase/migrations/20261025230720_flappy_admin_reward_preparation.sql
- lib/game/flappy/admin-review.ts
- app/admin/prize-review/flappy-race/page.tsx
- components/game/flappy-verified-canvas.tsx
- app/admin/prize-review/page.tsx
- lib/game/flappy/official-client.ts
- tests/integration/flappy-postgres.mjs
- tests/flappy-parity.test.mjs
- docs/flappy-parity-audit.md

## Production verification follow-up

Implementation commit: 84732eba8b5651f3ff64eeb00b479de1fc4fc971 on main.
Principal Vercel production deployment dpl_76bj3PLaWZdNdLZkWbYJhBFnYXqH:
READY, target production, aliases include www.racetowin.app and racetowin.app.
No new branch, Vercel project or Supabase project was created.

Read-only live checks:
- /games/flappy-race: HTTP 200 with new EXTRA LIFE UI.
- /api/flappy-race/leaderboard: HTTP 200, officialEnabled:false, entries:[].
- /api/leaderboard: HTTP 200, existing RTW ranking remains available.
- /admin/prize-review/flappy-race: HTTP 404 for unauthenticated visitor.
- Official START/CHECKPOINT/FINALIZE without a session: HTTP 401, bounded generic
  error, no competitive write. Authenticated gate behavior is covered in isolated tests;
  production signed-in official requests were not exercised.
- Public sign-in form renders with return-to-Flappy URL. No email/OTP/CAPTCHA submitted;
  this does not certify the full authentication round trip.

Browser QA: canonical public page at 1280×900 and 390×844, no horizontal overflow.
Verified expanded unavailable-ad explanation and disabled WATCH AD, truthful empty
ranking, guest sign-in gate, countdown and Game Over. Keyboard focus is CANVAS after
PLAY; SPACE was pressed during active practice and upward movement observed.
Pointer/canvas input and collision/Game Over were exercised at mobile width on an
existing alias of the same principal production deployment. Open Game Over reward
explanation stayed open beyond the ordinary dismissal period, with no ad or life grant.
These were practice-only checks, not official score writes; obstacle generation and
deterministic collisions are additionally covered by engine/real-PG tests. No claims
of a long obstacle-clearing browser run, physical-device Safari QA, full signed-in
official flow, automated load certification or a solved bot problem are made.

Backup dashboard check redirected to Supabase sign-in. The connector exposes no
backup creation/listing capability. Backup/PITR availability and recoverability remain
unverified; do not apply either migration until the owner supplies/validates that
precondition and explicitly authorizes the named production migration plan.
