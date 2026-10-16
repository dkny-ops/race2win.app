# Anti-automation laboratory (local only)

`scripts/lab/competitive-bot.mjs` is an adversarial **offline** benchmark. It
loads only the checked-out simulation and replay modules; it cannot open a
browser, send HTTP, use Supabase, read environment credentials, create users,
or write fixtures. Run it only with an explicit local guard:

```powershell
$env:RTW_OFFLINE_ANTI_AUTOMATION_LAB = '1'
node scripts/lab/competitive-bot.mjs
```

It compares four strategies against the current rtw-v7 simulation:

| Strategy | Purpose |
| --- | --- |
| `passive` | No inputs; baseline only. |
| `cadenced` | Weak fixed-cadence lane changes. |
| `predictive` | Source-aware beam search over legal lane changes. |
| `noisy-predictive` | Same planner with variable observation cadence. It is **not** described as human-like. |

Every candidate is re-evaluated with `replayAuthoritativeProgress`; a result
is discarded if score, distance, or state differs. The benchmark is evidence
that a replay can be authoritative and still be automated, not a mechanism to
drive live sessions.

### Measured local baseline — 2026-10-12

Using seeds `1, 2, 3` for 60 seconds each, with the checked-out rtw-v7
simulation and no network:

| Strategy | Runs surviving 60 seconds | Highest derived score | Notes |
| --- | ---: | ---: | --- |
| passive | 0/3 | 10 | Crashed at 2.85 seconds. |
| cadenced | 0/3 | 10 | Fixed 600 ms control cadence; crashed at 2.85 seconds. |
| predictive | 3/3 | 427 | All replay-verified. This is the relevant adversarial baseline. |
| noisy-predictive | 0/3 | 222 | Deliberately reduced observation cadence; not a model of human play. |

These are laboratory measurements, not detection statistics. The existing
`long-run-replay.test.mjs` independently covers a legal predictive driver
surviving a 12-minute source-simulation run. Neither result says a human would
perform similarly, nor that every seed has equal bot difficulty.

## Interpretation limits

- No legitimate-human timing dataset exists in this repository. Do not assign
  a human likelihood, detection percentage, or false-positive rate from these
  runs.
- A deterministic track permits a skilled human to memorize optimal movement.
  Perfect score, low reaction variance, repeated trajectories, an IP address,
  or a browser signal cannot alone prove bot use.
- The lab establishes a lower bound on automation risk. A browser bot may be
  weaker or stronger depending on its access to visible traffic and the seed.

## Required boundary before remote validation

No HTTP adaptation is supplied. A later, separately approved TEST-only run
must use synthetic identities, a bounded request budget, no OTP or ad traffic,
and an isolated non-prize week. It must prove that the browser-facing protocol
does not accidentally add a defensive signal absent from the replay contract.

## Findings from the checked-out implementation

The current server-side protocol is effective against a **forged** result: it
replays legal inputs and derives score, distance, elapsed time, collision, and
the replay digest on the server. Session ownership, checkpoint ordering, and
lease renewal add important integrity boundaries. They do not, however,
distinguish a legal replay produced by a person from one produced by software.

The official START response currently supplies the seed and rules needed by the
browser to render the race. A program with access to the same checked-out
simulation can use that information to plan only ordinary lane-change inputs,
then obtain a replay that the authoritative validator correctly accepts. This
is not a score-forgery finding; it is an automation/eligibility risk for a
cash-ranked game.

`fraud_flags` and `fraud_reviews` exist in the schema history, but this source
tree contains no integrated risk decision in START, CHECKPOINT, or FINALIZE.
The existing referral engagement checks also correctly reject trivial replay
patterns, but a source-aware varied script can satisfy their activity evidence.
Those checks must therefore not be represented as human attestation.

## Proposed defense-in-depth architecture (not implemented)

1. **Keep the authoritative replay boundary.** Never accept browser score,
   time, distance, position, eligibility, or risk verdict. It remains the
   fraud-score foundation, not a bot detector.
2. **Record narrow, auditable server-derived risk evidence.** Examples include
   per-account session cadence, server-observed concurrent sessions, exact
   replay-digest reuse, and cross-account clusters that independently exceed a
   predeclared threshold. Browser claims such as `webdriver`, WebGL details,
   or `isTrusted` may only be low-confidence advisory signals.
3. **Separate detection from irreversible enforcement.** A high-risk winning
   result should be held for `fraud_reviews` and owner review, not silently
   deleted, shadow-banned, or permanently blocked. No single signal (score,
   IP, perfect movement, or a browser fingerprint) may deny a prize.
4. **Protect account and prize boundaries.** Turnstile plus server-verified
   rate limits reduce account automation, but do not attest to gameplay. For
   an otherwise eligible winner, require a recent server-verified human
   challenge and a reviewable eligibility check before the already-manual
   payout approval. Never run a challenge during a driving maneuver.
5. **Apply graph review to referrals.** Confirmed referrals still require the
   existing registration, email, and official activity checks. Flag—not
   automatically pay or reject—coordinated account, replay, and referral
   clusters for review.

This needs a separate schema/API design before implementation: bounded
retention, service-role-only writers/readers, fixed `search_path` for any
SECURITY DEFINER function, explicit RLS/GRANT tests, and a user-visible appeal
or review path for prize-affecting holds.

## Track experiments (not official gameplay)

| Scenario | Benefit | Limitation | Safe experiment boundary |
| --- | --- | --- | --- |
| A — current deterministic seed | Reproducible authoritative replay | A source-aware planner can know future traffic | Baseline only; never call this bot a human model. |
| B — server-private future segments, revealed only near the visual horizon | Removes complete-track look-ahead from the browser | A bot can still react to visible obstacles or screen pixels | Separate protocol/version and test arena; server must retain enough committed segment data to replay. |
| C — dynamic safe-route segments with frequent decisions | Reduces value of a memorized fixed route | Can harm accessibility or create unavoidable walls | Experimental generator must prove at least one lane is reachable after each reveal; no rollout into rtw-v6/v7 without playtesting. |

For B/C, select reveal horizons using measured human play and accessibility
testing, not an assumed reaction-time threshold. A server-hidden seed is not a
complete anti-bot solution; it merely removes one privileged prediction input.

## Evaluation protocol before any prize claim

Collect consented, privacy-minimized legitimate samples separately from the
development set. Compare held-out human sessions with multiple independent
local bot strategies; report the sample sizes, false-positive/false-negative
counts, and configuration version. Do not retain invasive mouse biometrics or
persistent device fingerprints unless their necessity, retention, consent, and
appeal process are separately approved. No real detection rate can be claimed
until this protocol is complete.

## Additional anti-bot layers — design only

### 1. Honeypots and hidden knowledge

The current replay protocol does not have a safe place to introduce a
honeypot: the browser receives the full seed, and an input is an ordinary legal
lane change. Adding a fake obstacle to the official track would be unfair;
adding a DOM control that is not visually meaningful can also harm assistive
technology. Therefore **no honeypot is implemented in the official game**.

The following are controlled experiments for a future non-prize test arena:

| Experiment | What it measures | Safety guard | What would falsify its value |
| --- | --- | --- | --- |
| Future-segment probe | Correlation between a lane action and a server-private segment that was not yet rendered | It never changes collision, score, or the safe corridor; it records only a review signal | A local bot that uses only rendered state gets the same flag rate as a source-aware bot, or a bot can trivially ignore it. |
| Decoy accessibility-safe affordance | Whether generic browser automation activates a hidden non-game control | Never actionable, never focusable, no effect on gameplay; exclude assistive-technology sessions from evaluation | Legitimate keyboard/screen-reader flows trigger it, or a bot can simply ignore it. |
| Delayed visual-horizon commitment | Whether an input sequence systematically anticipates unrevealed traffic | Separate experimental protocol; no official-score effect | A visible-only bot retains the same performance, showing that future knowledge was not the advantage. |

No isolated event is evidence of automation. A probe can at most raise an
auditable review signal after repeated independent observations. We must test
every probe against source-aware, visible-only, random, and accessibility
fixtures before it is considered useful. A capable bot can detect or avoid
decoys; honeypots are therefore a research signal, not an enforcement root of
trust.

### 2. Account-farm and prize-review controls

We should construct a server-side review graph only from necessary, bounded
evidence: verified-account age, official-session timing, exact replay digest
reuse, normalized input-pattern similarity, referral relationships, and
server-observed concurrency. Browser device and network hints may add context
only; an IP address, resolution, device, high score, or shared network must
never produce an automatic ban or prize denial.

For a potential winner, the recommended state transition is:

```text
authoritative valid result
  -> provisional contest result
  -> multi-signal risk evaluation
  -> clear OR transparent hold for fraud_review
  -> owner approves/rejects payout
```

The hold must name a review status to the player, retain the evidence and
detector version, have an appeal/review path, and leave the human owner as the
only payout authority. No automatic payment, silent exclusion, or irreversible
shadow ban belongs in this flow.

### 3. Telemetry and statistical/ML evaluation

There is no legitimate-human dataset in this repository, so an Isolation
Forest—or any other anomaly model—would currently learn only the difference
between synthetic bot generators. That is not a human detector and must not
be deployed.

Once consented data exists, use a versioned, privacy-minimized feature contract
and split data by player/account and time before training, so portions of one
player's behavior cannot appear in both training and evaluation. Compare a
simple reviewed statistical baseline with an anomaly model on held-out data:

| Measure | Required reporting |
| --- | --- |
| Known-bot detection | Count and rate by bot family, separately from training data. |
| Unknown-bot detection | A strategy omitted from model development. |
| False positives / negatives | Counts, denominators, confidence limitations, and reviewer disposition. |
| Cost / performance | CPU and storage per finalized run and p95 evaluation time. |
| Drift | Game version, detector version, data window, and a re-evaluation schedule. |

No synthetic-only model may be called production-ready, and a high anomaly
score must route to review rather than become a solitary rejection rule.

### 4. Integrity is not humanity

| Control | What it proves | What it cannot prove |
| --- | --- | --- |
| Server replay, digest, checkpoints, and lease | A session-owned legal input timeline matches the authoritative game | A person supplied the inputs. |
| Signed/rotating session token and monotonically ordered input batches | A batch belongs to a current session and was not substituted or replayed out of order | A human operated the session. |
| `navigator.webdriver`, `isTrusted`, WebGL, or user-agent hints | At most a manipulable advisory attribute | Identity, absence of automation, or eligibility. |
| Code obfuscation and visual randomization | Raises reverse-engineering cost temporarily | Security against a determined client-side adversary. |

Input-batch chaining is worth a separate integrity design only if it preserves
retry/idempotency and the server remains able to reconstruct the full replay.
It can reduce duplicate/substitution ambiguity, but it does not resolve the
predictive-driver result. Any rotation should be versioned, server-generated,
and compatible with recovery after a network interruption; it must not depend
on a secret kept in browser JavaScript.

### 5. Human experience and review

The low-friction controls already being prepared—email verification,
Turnstile at account-risk boundaries, and rate limits—help deter bulk account
creation but do not establish in-game humanity. Future adaptive challenges
belong before OTP, at account recovery, or during prize eligibility review,
never in a driving maneuver. Community reports can create a review item but
cannot by themselves change scores or prize eligibility. Review the Top 10–50
and every winner with replay playback and the same documented criteria; review
must include a false-positive remedy.

## Priority order and decision experiments

Only the first item below has demonstrated efficacy in this repository, and
only against forged data—not automation. All other entries are proposals until
their stated experiment is completed.

| Priority | Layer | Evidence status | Expected effectiveness | Difficulty / cost | Privacy / false-positive risk | Experiment required before any enforcement |
| ---:| --- | --- | --- | --- | --- | --- |
| 1 | Authoritative replay and financial server boundaries | Demonstrated locally | High for forged score, payout, or ownership attacks; none for a valid bot | Existing; no new service | Low / low | Preserve regression suite; attack malformed and cross-account evidence. |
| 2 | Winner hold plus documented manual fraud review | Proposed | High for limiting payout impact while uncertain | Medium / primarily operational | Medium / mitigated by transparent review | Run synthetic winner/farm cases and verify no auto-payment or irreversible exclusion. |
| 3 | Account/referral graph and bounded server-derived signals | Proposed | Potentially useful for coordinated farms | Medium / local storage and review work | Medium / do not use a single IP/device signal | Compare independent versus coordinated synthetic account graphs; measure reviewer precision. |
| 4 | Progressive private future segments in a test arena | Proposed | Removes full-track look-ahead | High / protocol and accessibility work | Low–medium / risk of unfair difficulty | Compare the predictive lab bot with a visible-only bot; prove a reachable path. |
| 5 | Statistical baseline then anomaly model | Not eligible yet | Unknown without real human samples | Medium–high / ongoing measurement | High if misused | Holdout human study, known/unknown bot sets, FP/FN report. |
| 6 | Honeypot probes | Unproven | Low–unknown, evasible | Medium | High if accessibility is neglected | Multi-probe experiment with accessibility fixtures; discard if false positives are not negligible. |
| 7 | Browser hints / obfuscation | Advisory only | Low against determined automation | Low–medium | High if used as enforcement | Verify they never affect score, eligibility, or payout alone. |

### Implementation gates

1. Do not alter rtw-v6/rtw-v7, official scoring, or economic rules while
   collecting the missing evidence.
2. Select a data-retention and player-notice policy before any new telemetry.
3. Build the winner-review state machine and service-only audit storage first;
   prove RLS, idempotency, and no automated payout in local/PostgreSQL tests.
4. Create a separate non-prize dynamic-track arena only after its safe-route,
   mobile accessibility, and visual-horizon tests are specified.
5. Collect consented human data, then evaluate statistical and ML candidates on
   a held-out set. Reject any detector whose benefit does not exceed its
   measured false-positive and operational cost.
