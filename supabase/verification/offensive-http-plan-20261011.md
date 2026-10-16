# Race To Win Offensive HTTP Plan

Status: PREPARATION ONLY. No writes for this plan were sent to Supabase TEST. Production is prohibited.

## Target And Identity

- Supabase project fixed to `lndvnufmbuzdbinapvze`.
- Execute the Next.js handlers locally at loopback only; the handlers use the fixed TEST Supabase environment.
- Create at most two new synthetic Auth users after explicit authorization. Generate passwords in memory, confirm email administratively, sign in without email/OTP, and do not persist passwords or access tokens.
- Use the existing inventory at `offensive-test-inventory-20261011.json` for old run cleanup. Never reuse those sessions as new test cases.
- Use separate attacker and owner synthetic identities. Session-owner assertions derive only from verified Supabase Auth cookies.

## Actual API Surface

| Method and route | Purpose | Player authority |
|---|---|---|
| `POST /api/game-sessions/start` | Start an official session | Authenticated player; server creates seed/session |
| `POST /api/game-sessions/checkpoint` | Submit replay evidence for a milestone | Authenticated owner; replay and rate limit required |
| `POST /api/game-sessions/finalize` | Finalize a completed run | Authenticated owner; server replay and DB finalizer |
| `GET /api/leaderboard` | Read public rankings | Bounded public read |
| `GET /api/prizes/claimable` | Read caller's eligible awards/balance | Authenticated player, owner-scoped reads |
| `POST /api/prizes/claim` | Begin claim for a provisional winner | Authenticated player; cannot approve or pay |
| `POST /api/prizes/balance-claim` | Request a balance payout hold | Authenticated player; cannot mark paid |

Additional attacker traffic goes directly to Supabase REST using the public key and either no bearer or a synthetic player's access token. No attack request may carry the service-role key.

## Attack Matrix

All requests are followed by owner-scoped GET snapshots. An HTTP status alone is not a pass. Save status, sanitized response code, and before/after IDs/counts; never save tokens, cookies, emails, or provider secrets.

| Attack | Request | Expected response | Required state assertion |
|---|---|---|---|
| Anonymous session start | POST start without cookie | 401 | No new session |
| Invalid bearer/cookie | start/checkpoint/finalize with malformed token | 401 | No session/result/checkpoint mutation |
| Forged score, distance, elapsed time, collision, or digest | FINALIZE with unexpected metric fields | 400 | Session remains active; no validated run/top/week/finance row |
| No completed run | FINALIZE empty or fabricated input evidence before replay can prove collision | 409 | No finalized status/result/checkpoint |
| Owner impersonation | attacker token, owner's session ID | 404 | Owner's session byte-for-byte unchanged |
| Foreign checkpoint | attacker token, owner's session ID | 404 | No checkpoint or lease change |
| Fake/reordered/contradictory checkpoint | checkpoint index beyond replay, malformed prefix, altered digest | 400/409 | No proof and no lease renewal |
| Finalized session replay | exact evidence then altered evidence on a marked synthetic finalized fixture | exact retry canonical; altered evidence 409 | One validated run maximum; stored result immutable |
| Expired session/lease | marked synthetic fixture with old start and expired lease | 409 | No result; no unrelated session mutation |
| Direct ranking DML | anon and synthetic player POST/PATCH/DELETE against `validated_runs`, `daily_top_scores`, `weekly_tournament_totals` | 401/403 | Before/after snapshots identical |
| Direct finance DML | anon and synthetic player POST/PATCH/DELETE against winner, ledger, balance, payout tables | 401/403 | Before/after finance snapshots identical |
| Player attempts admin approval | call `rtw_admin_transition_winner` with public key and synthetic/fake winner ID | 401/403 | No winner, ledger, balance, or payout change |
| Synthetic prize claim | POST claim with nonexistent synthetic winner ID | 409 | No award or ledger row |
| Synthetic balance claim | POST empty body with no synthetic eligible balance | 409 | No payout or ledger row |
| Leaderboard parameter abuse | invalid week, oversized page/pageSize, extra/malformed query values | 400 or bounded canonical read | No writes; synthetic users/results do not alter current-week ranking |

Do not attempt a successful competition run in the current week. For finalized/expired test fixtures, use only explicit synthetic fixture setup in an isolated historical/future week after authorization, record every ID before the first write, and keep all player attacks on the HTTP routes/public key. Any service-role setup is fixture creation, never an attacker request.

## Isolation And Cost Gates

1. Require official folder, official branch, exact TEST URL and `lndvnufmbuzdbinapvze` credential scope before each run. Fail closed if Production ref appears anywhere in the effective environment or target URL.
2. Require explicit execution authorization and the existing quota-confirmation gate. The key is loaded privately and never printed or added to the manifest.
3. Use at most two newly created synthetic users and a small bounded session set; no OTP, Turnstile, email, prize allocation, payment, or payout settlement calls.
4. Estimate 2 Auth user creations, up to 4-6 sessions, and fewer than 100 REST/API requests, then read-only before/after snapshots. No payment transaction is initiated. Supabase request/Auth/DB usage is nonzero; monetary cost cannot be guaranteed without the project's billing/quota status. Stop unless the owner confirms these calls incur no additional charge.
5. Stop immediately if an identity, result, or finance row fails the synthetic ownership predicate, or if any non-synthetic week/player appears in the scoped snapshot.

## Existing Scripts And Blockers

- `scripts/test-concurrency-api.mjs` is a service-role RPC runner, not a player HTTP attack harness. It is unsafe to treat its privileged RPC score claims as proof of player reachability. It must not be used for player attacks unchanged.
- `scripts/test-concurrency-test.mjs` is a separate direct PostgreSQL multi-connection lock test. It requires the private TEST session-pooler URL and `pg`; this audit did not connect or execute it.
- `concurrency-api-cleanup.sql` is not currently executable safely: it raises if any validated run exists, while the inventory confirms 13. It was not run. Prepare and review an exact-ID cleanup transaction that locks and verifies the run marker, known users/sessions/result IDs/proofs, confirms finance remains empty, deletes only their dependent rows in FK order, and verifies zero remaining rows. Stop cleanup if any count or ownership marker differs.
- The existing fixture week is isolated to `2099-02-09`; read-only TEST inspection found 13 validated runs, zero Top 7 rows, zero weekly totals, two checkpoint proofs, and zero winner/ledger/balance/payout rows. The full IDs are in `offensive-test-inventory-20261011.json`.

## Authorization Required Before Validation

No phase-2 requests or fixture writes are authorized by this plan. Before proceeding, the owner must explicitly authorize: (a) creation of up to two synthetic Auth identities and the bounded synthetic sessions described above in TEST only; (b) the expected Supabase usage after confirming no extra charge; and (c) the separate multi-connection SQL test only if a TEST-only TLS pooler connection is available. Existing fixtures remain untouched until a separately authorized final cleanup.