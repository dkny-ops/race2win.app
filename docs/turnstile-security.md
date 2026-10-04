# Turnstile activation plan

This repository contains a server-only verifier, but no route currently calls it.
That is intentional: Turnstile is not active until it has been configured and
validated in Preview/TEST.

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

## Planned integration boundary

1. Add a Turnstile widget on the sign-in form and require an `otp_request`
   verification before requesting an OTP.
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
