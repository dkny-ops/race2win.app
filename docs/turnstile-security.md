# Turnstile activation plan

The OTP request route calls the server-only verifier before its abuse limiter and Auth provider. Disabled enforcement preserves the DB limiter; enabled but incomplete configuration fails closed. The widget requires the otp_request action and uses Script.onReady to handle navigation back to sign-in.
Activation must be verified separately for each running environment. Local
activation does not establish Preview or Production readiness.

## Local audit — 2026-10-11

### Native CAPTCHA remediation (latest local changes)

### Return-to-sign-in widget lifecycle correction

Final checks for this correction: 91/91 automated tests passed, ESLint,
typecheck, production build and diff whitespace checks passed. The new
regressions use provider doubles; authenticated real-browser acceptance is
still pending. No OTP emails or hosted configuration changes were made.

Both widgets previously owned a Next Script with the same URL. The installed
Next loader's concurrent `ScriptCache` path chains `onLoad`, not `onReady`,
for a duplicate script; a second widget could miss its readiness notification.
The form now owns one script loader and broadcasts readiness to both widgets.
Each widget couples creation with cleanup, clears its token on mount/unmount,
and rejects callbacks from a removed generation. Strict Mode effect replay
creates fresh instances instead of leaving a removed instance in state.
Submission still clears both tokens; the API/native CAPTCHA checks are unchanged.

`turnstile-navigation-lifecycle.test.mjs` executes the real component's effect
setup/cleanup with React-hook and provider doubles: two ready instances,
unmount, cached-ready remount, fresh independent tokens, stale callbacks,
and Strict Mode replay. It does not simulate an authenticated browser session
or prove a real Cloudflare token. The actual logout route uses a POST/303 home
redirect and browser form navigation; this is separate from a widget reset.
No token is stored in logout cookies or localStorage. Do not remove provider
rate limits or the resend cooldown to repair widget visibility.
An isolated browser observation navigated from sign-in to HOW IT WORKS and
back via SIGN IN TO COMPETE, without reload: both widget containers were
present again. No email or login was attempted and no real token was inspected.
This is a navigation observation, not a completed authenticated-flow test.

Browser acceptance: after the existing server refreshes the local changes,
sign in once with both verifications, log out, then use SIGN IN TO COMPETE
without browser reload or an extra HOME detour. Both widget instances must
be available; Managed mode need not show a checkbox challenge. Wait for the
existing cooldown before one optional new OTP. No repeated email test was
run automatically. Full authenticated browser acceptance remains pending
because the user's existing browser session was not exposed to the tools.

Status: implementation prepared; hosted closure NOT VERIFIED.
Final local validation: 89/89 tests passed, lint passed, typecheck passed,
build passed, and diff whitespace checks passed. The initial full run caught
an outdated parser assertion; after correction the complete suite passed.
Lint also caught a test-local variable named `module`; it was renamed and
lint rerun successfully. GET localhost `/sign-in` returned 200 with both
widget containers; this checks rendered integration, not real token solving.
An exact-value scan of 80 browser assets found no configured private keys.
Only local application/frontend code, tests, the negative-check script and
this document changed for the remediation; earlier local advances remain.
The owner subsequently confirmed real widget success, email delivery, login,
and old/new OTP rejection/acceptance. Preserve those results; they establish
the previous application flow, not the new native-CAPTCHA integration.

The form now collects two independently issued Turnstile tokens using the
existing real localhost widget site key. Both use `otp_request`. The server
consumes only `turnstileToken` with its exact hostname/action validation.
It requires `supabaseCaptchaToken` to be nonblank, at most 2048 characters,
and different from the first token; only that second token goes to the public
Auth client's `options.captchaToken`. Supabase performs its verification.
Both frontend tokens reset after every submit attempt; browser booleans are
never accepted as proof. The OTP request body alone has an 8 KiB streamed cap
to fit both tokens; competition mutation limits remain 2 KiB.

Do not enable a service-role Auth client: Supabase's upstream CAPTCHA
middleware explicitly exempts administrative authorization. The current
application uses the public credential and preserves signed admission cookies,
DB HMAC limits, neutral request responses and OTP verification limits.
Upstream `/verify` currently has rate limiting but no CAPTCHA middleware, so
no additional widget was added to code entry; confirm hosted compatibility
with the new request flow before declaring it complete.

Upstream protects `/otp`, `/signup`, `/recover`, `/resend`, `/magiclink` when
native CAPTCHA is enabled. Configuration-disabled middleware permits requests
without CAPTCHA. Public callers with a valid independently solved CAPTCHA
can still use Auth directly and do not traverse the application's HMAC quota;
native Auth rate limits must bound that traffic. CAPTCHA is not a mail budget.
The application message is neutral, but `nextStep` reveals whether admission
was issued; it is not a guarantee of identical account-state behavior from
Supabase's public APIs. Do not claim elimination of all email enumeration.

Sources (upstream source is evidence of design, not a hosted-version test):
- https://supabase.com/docs/guides/auth/auth-captcha
- https://github.com/supabase/auth/blob/master/internal/api/middleware.go
- https://github.com/supabase/auth/blob/master/internal/api/api.go

#### Manual TEST configuration, after reviewing the effect

Effect: CAPTCHA becomes mandatory at TEST public email-generating Auth
endpoints. Old clients without CAPTCHA stop sending OTP; existing sessions
are not deliberately revoked. This does not change SMTP, prices or limits.
No dashboard configuration was modified by this audit.

1. Open https://supabase.com/dashboard/project/lndvnufmbuzdbinapvze/auth/protection
   and confirm the TEST project reference before editing. If the UI route
   changes, use Authentication > Bot and Abuse Protection.
2. Enable CAPTCHA protection, choose Cloudflare Turnstile, and privately paste
   the real localhost widget's secret from `TURNSTILE_SECRET_KEY` in the
   official `.env.local`. Never use a dummy key or share the secret in chat.
3. Save in TEST only. Leave local enforcement enabled and keep the widget
   restricted to localhost. Do not change Production or provider rate limits.
4. Inspect Authentication > Rate Limits and SMTP/Resend free quota. Record
   nonsecret limits only; do not raise them to make a test pass.
5. Run in the official folder:

   ```powershell
   Set-Location -LiteralPath 'C:\Users\crist\Documents\Codex\race2win-readiness-20261010'
   node scripts/verify-native-captcha-test.mjs
   ```

The script uses only the public TEST key, no cookies or administrative bearer,
and malformed email `not-an-email` to prevent email delivery or account
creation. It checks missing/invalid tokens on five direct Auth routes, stops
at the first unexpected response and prints no response body or secrets.
Only explicit `captcha_failed` 4xx counts as PASS; invalid-email errors, 429,
5xx, transport errors or 2xx do not prove protection. Because native middleware
runs before handler email validation, CAPTCHA failures on malformed requests
are high-signal evidence of enforcement, but a valid-address negative control
remains optional additional evidence once quotas/recipient are authorized.
The current attempt ended with connection unavailable and 0/10 verified;
it neither demonstrates the bypass nor closes it.

6. After direct negative checks pass, a single owner-authorized TEST email
   verifies the changed two-token path. Earlier OTP results are retained and
   need not be repeated as a regression suite; this is the new integration
   control. Do not send it automatically or repeatedly.

Recovery: if native activation fails, preserve both protections and stop OTP
requests. Check widget secret/project, fresh distinct tokens and CAPTCHA
diagnostics. Fix configuration and retry only after diagnosis; do not disable
CAPTCHA, switch to an admin Auth key, or reuse tokens as a workaround.

The earlier audit notes below describe the pre-remediation implementation.

Official folder: `C:\Users\crist\Documents\Codex\race2win-readiness-20261010`.
Branch: `fix/production-readiness-20261010`; base `cc6aba2` plus existing local changes.
Only server: `http://localhost:3000`; only Supabase: TEST `lndvnufmbuzdbinapvze`.

- Effective locally loaded configuration has enforcement enabled, exact
  `localhost`, action `otp_request`, and distinct public/private keys. Secrets
  were never printed. GET `/sign-in` returned 200 with the widget container
  and Cloudflare script. The user reported a real widget success; that is not
  evidence of successful server validation or email delivery.
- Real localhost POSTs without a token and with a fabricated token returned
  202, `nextStep: false`, and no admission cookies. Neutral 202 means denied
  admission, not accepted email delivery. The fabricated-token response alone
  cannot distinguish provider rejection from provider unavailability.
- 87/87 automated tests passed; ESLint, typecheck and production build passed.
  Token expiry/reuse, wrong hostname/action, provider outages, and successful
  OTP continuation are covered with provider/Auth doubles, not real browser
  tokens. No email was sent by this audit.
- A read-only query of TEST confirmed request limits: one request per email
  per 60 seconds, 30 per global shard per 60 seconds; verification limits:
  three per email and 60 per shard per 60 seconds. There are 64 deterministic
  HMAC shards. This bounds application requests, but is not a single account
  email budget and does not cover direct Supabase Auth calls. Atomic SQL,
  fixed lock order, private tables, service-only RPC, and fail-closed behavior
  were reviewed and covered by local tests. Hosted concurrency was not tested.
- `.env.local` is ignored and untracked. Git ignore prevents ordinary staging,
  but can be overridden with `git add -f`: never force-add environment files.
  Server verifier and abuse modules use `server-only`; the frontend receives
  only the site key. An exact-value scan of 80 browser asset files found none
  of the configured Turnstile secret, service-role key or abuse HMAC key.
  Build-generated type paths were restored to the original
  development paths after verification to preserve local changes.

### Remaining security boundary: direct Supabase Auth

The repository contains one `signInWithOtp` call, inside the protected route.
Nevertheless, the public Supabase URL/key permit callers to address Auth
directly. Current hosted CAPTCHA configuration could not be read: the local
network request was unavailable. Do not assert that alternate OTP routes are
closed until TEST Authentication > Bot and Abuse Protection is checked.

The application consumes the Turnstile token itself and currently calls
Supabase Auth without `captchaToken`. Do not simply enable native CAPTCHA or
forward that consumed token: Turnstile tokens are single-use. Closing both
boundaries requires a reviewed integration design and a fresh-token test.
No hosted settings were changed, and no direct OTP request was attempted.
Reference: https://supabase.com/docs/guides/auth/auth-captcha

### Real Cloudflare versus simulated tests

The dummy-key provider script in this audit could not reach Cloudflare
(`EACCES`); this run is NOT VERIFIED. A previous session did execute three
Siteverify calls with official dummy keys, but those keys simulate outcomes
and do not prove validation of the new real widget. Their action is `test`,
which must remain rejected by the `otp_request` boundary.
Real widget expiry, reuse, wrong action/hostname and a successful server
validation remain pending; no enforcement was disabled to obtain a pass.

### One authorized final email test

After the user authorizes one email and confirms free SMTP quota, open
`http://localhost:3000/sign-in`, use the owner's TEST email, wait for a fresh
widget Success, and submit once. In browser Network inspect only the status
and `nextStep` of `/api/auth/request-code`; never copy tokens, keys, or cookies.
Success requires `nextStep: true`, arrival of one OTP, and successful code
entry. Record results without private values. If `nextStep` is false or no
email arrives, stop and inspect allowlisted server diagnostics; do not resend.
Widget Success alone does not pass this test. A successful email test also
does not resolve the direct Auth boundary above.

## Configuration

Set these per environment, never in source control:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: optional public widget site key. It must
  never contain the secret key.
- `TURNSTILE_SECRET_KEY`: server-only Cloudflare secret key.
- `TURNSTILE_ALLOWED_HOSTNAMES`: required comma-separated exact hostnames, for
  example `www.racetowin.app`. Wildcards, URLs, ports, and paths are rejected.
- `TURNSTILE_ENABLED_ACTIONS`: required comma-separated server allowlist drawn
  from `otp_request`, `otp_verify_step_up`, `prize_claim`, and `balance_claim`.
- `TURNSTILE_ENFORCEMENT_ENABLED`: must equal the exact string `true` before
  verification is attempted. Any other value leaves the module disabled.

An enabled-but-incomplete configuration returns `unavailable`; it is never a
successful human verification. The sign-in page derives widget visibility from
the same complete server configuration, so there is no independent browser flag
that can drift from server enforcement. A future protected route must fail
closed on `rejected` and `unavailable` once its rollout is deliberately enabled.

## Integration boundary

1. The sign-in form collects the widget token; when enabled, the request route
   requires `otp_request` verification before the DB limiter and OTP provider.
2. Keep `otp_verify_step_up` available only for risk-triggered verification;
   do not challenge every OTP attempt by default.
3. Require a recent, server-verified proof at prize/balance claim boundaries.
   This needs a separate design for server ownership, expiry, one-time use, and
   storage before it is implemented. A browser boolean or client timestamp is
   never proof.

The verifier sends no untrusted IP value because a trusted proxy source has not
been configured. It does not log or persist tokens, and does not retry a token.
Cloudflare Siteverify is the authority for its five-minute, single-use token
semantics. See the official [Server-side validation documentation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

## Safe activation order

1. Create/configure widgets and secrets outside this repository.
2. Add the server-only variables to Preview with TEST-only hostname/action
   values, while `TURNSTILE_ENFORCEMENT_ENABLED` remains unset.
3. Implement and test each route integration behind a deliberate explicit
   enablement gate; do not enable all protected operations at once.
4. Test valid, invalid, expired/reused, action-mismatch, hostname-mismatch,
   timeout, and provider-outage flows in Preview/TEST.
5. Repeat the configuration and controlled verification in Production, then
   enable one boundary at a time.
