# FlappyRace official circuit — production work record

Base: 7a9d5290bab1768b5c63d5233cd32c74652217bf.
Settings published in 32af7baa and language synchronization in 3ebebb5b.
Desktop Spanish and mobile English verified on the principal public page without reload.

## Scope and gates

The existing flappy-v1 integer 60 Hz authoritative engine, server-only session
seed/start/checkpoint/finalize, persistent quotas and input/clock/ownership checks
remain unchanged. Practice stays independent of Race To Win's guest trial.

New review endpoint rechecks the confirmed owner/active-admin guard, exact same
origin, bounded body, immutable persisted replay, digest, score and collision.
Approval requires an explicit human assessment of automation risk and a reason.
Rejecting does not require a matching replay. Actor identity never comes from
the request. SQL serializes review/closure by week, locks the run and records
one immutable review event; exact retries are idempotent and conflicting decisions
are refused. No automatic approval or cash credit exists.

Only private Flappy runs feed the independent leaderboard. Daily seven, NY
Monday–Sunday and descending individual score vectors are preserved. Exact ties
have no numeric rank and never become arbitrary winners.

Weekly closure is MANUAL in the owner panel. It requires the week to have ended,
an 11-minute settlement margin (longer than the maximum session+countdown), and
zero under-review results. A single closure and per-player standings snapshot
freeze the outcome; repeats return the canonical closure. Review and closure
share a transaction advisory lock. Ties stay pending. Closure cannot credit a
balance, allocate money, pay a prize or turn a sporting placing into a withdrawal.

The public tournament endpoint exposes only status and public winner names/scores.
No email, payout, actor, seed or input evidence is public.

## Production baseline / recovery boundary

At 2026-10-26 03:59:22 UTC, production lndvnufmbuzdbinapvze had zero Flappy sessions,
runs, quotas and reward reservations; control was singleton=true, enabled=false.
Seven existing public Flappy definitions digest:
6a74e47c6f7c05a86907011736e34c17.
Non-Flappy public/private function digest:
7908d6342ceb4ea7d88d386934f870eb.
Original Flappy schema/functions are preserved in registered migrations
20261026015010 and 20261026015651. This is a scoped empty-data/schema recovery
baseline, NOT a verified full-project backup/PITR or restore drill. RTW data,
functions and financial objects are outside the migration's write scope.

Migration is additive except replacing the two Flappy review/ranking functions.
It registers Flappy paused and leaves all gates closed. Failed application must
roll back its transaction. If an app regression occurs, restore the previous Vercel
deployment, close Flappy gates and retain evidence; correct Flappy functions using
a targeted forward migration. Never reset/drop shared production data.

No general db push, local test database, alternate Supabase/Vercel project, branch
or preview is used. The migration service assigns the canonical migration version;
the exact applied SQL is then synchronized to that registered version in GitHub.

## Verification discipline

Production build runs typecheck, automated tests and Next build before publication.
Database checks run as explicit transactions with final ROLLBACK, using existing
identities only for uncommitted fixtures. No fake official score or user is retained.
RLS and grants remain enabled; role denial is checked using actual database roles.
A physically valid bot remains a known risk; all finalized runs start under_review.

Status and final verification are appended after execution. No successful build
alone certifies the official circuit or removes the independent activation gates.
Rewarded EXTRA LIFE/2X, withdrawable prizes and automatic payments remain disabled.

## Verified production results (before activation)

Migration 20261026041054_flappy_review_and_weekly_closure applied successfully.
Typecheck, all 93 tests at cb2c455, and Next production build passed in Vercel.
Production transaction assertions passed: real START/checkpoint/finalize, immutable
prefix, duplicate FINALIZE, default under_review, admin authorization, exact review
retry, conflicting review rejection, rejection audit, pending-review closure block,
current-week closure block, top-seven daily total, individual vectors, absolute ties,
canonical closure retry, frozen standings, and a 169-hour DST week.
Anonymous EXECUTE and authenticated private-table access were rejected using actual
roles. All eight private Flappy tables have RLS, all nine public RPCs deny browser
roles, and service_role has no direct Flappy table privileges.
After ROLLBACK: runs=0, review_events=0, closures=0, gate=false, catalogue=paused.
Non-Flappy function digest remained 7908d6342ceb4ea7d88d386934f870eb.

Before activation, official server operations are being aligned with the existing
live access-hold and 2026-10-18 terms policy. Held players cannot be approved.
The canonical HTTP GET checks use the public browser URL; the Vercel fetch connector
adds a share query that strict API validation intentionally rejects with 400.

Official countdown scheduling now uses the server START response clock reference
plus performance.now(), not the player's wall clock. This avoids legitimate clock
skew creating premature input evidence. The database still enforces elapsed time
and leases; the client never chooses an official start time.

## Non-financial activation

At f381c418, production typecheck, 98/98 automated tests and Next build passed,
including holds, terms policy and server-clock scheduling tests.
Production migration 20261026042207_flappy_activate_reviewed_nonfinancial_competition
verified RLS, browser EXECUTE denial, absence of direct table privileges, function
search_path/definer configuration, owner review availability and zero retained
fixture data before setting Flappy catalogue active and its private database gate true.
The independent source-code gate is enabled in the accompanying reviewed commit.

This enables authenticated official play; every FINALIZE still creates under_review.
Only explicit owner approval can enter the ranking. Closure remains manual and
requires complete review. No economic rules, prize amounts, payable balances,
automatic award/payment job, ad provider or extra-life grant were enabled.

Production SQL verification used existing identities and real roles inside rollback
transactions; it does not replace an actual signed-in browser playthrough. The
current browser session is unauthenticated, so the first authenticated browser run
and owner-panel button interaction are not claimed as completed. Negative endpoint,
public ranking/tournament and desktop/mobile language checks are verified separately.
The old fresh-install behavior fixture was not rerun: the user explicitly forbids
local/alternate test environments and general migration-history replay. Its prior
hourly-quota fixture failure is historical, not evidence that runtime quotas were
weakened or that the complete historical migration harness now passes.

## Effective public state and remaining limits

Migration 20261026042525_flappy_publish_effective_tournament_state exposes the
effective private gate AND active Flappy catalogue as a boolean in the restricted
ranking RPC. The HTTP reader additionally requires the reviewed source-code gate.
While the status request is loading, the page displays “Checking tournament status”
instead of prematurely claiming the tournament is disabled.

Public browser verification after activation: leaderboard game=flappy-race,
week=2026-10-26, officialEnabled=true, entries=[]; previous-week closure status
ready_to_close with no winners, prizesEnabled=false and paymentsEnabled=false.
No real week or winner was fabricated. Final UI/deployment checks are recorded in chat.

Known Supabase advisory: pre-existing leaked-password protection is disabled;
this delivery does not change Auth settings. [Remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
RLS/no-policy INFO notices are intentional deny-browser tables with explicit grants
verified, not a reason to grant browser access.

Commits for this mission: Settings 32af7baa, immediate language synchronization
3ebebb5b, official review/closure cb2c4557, access/registered migration 045cfac4,
server-clock client f381c418, reviewed activation 9494ffd1, unique Settings selects
f725a593, plus this effective-state verification commit. Other concurrent navigation
and Settings styling changes on main were preserved.

Not enabled: ad-based extra life/2X, economic prize rules, withdrawable Flappy balances
or automatic payments. Weekly closure is manual, with exact ties pending review.
A real signed-in browser run and owner-panel click-through still need the user's
authenticated session; SQL/authorization/replay checks are not misreported as that test.
