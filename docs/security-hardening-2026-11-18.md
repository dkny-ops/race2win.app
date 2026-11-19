# Security hardening — 2026-11-18

## Scope and safety boundary

This change set is local only.  It does not apply database DDL, create prizes,
change balances, approve winners, or execute payments.  Deployment remains
blocked until the migration and production configuration below are reviewed.

## Implemented locally

- Dependencies: Next.js is pinned to `16.4.5`, Sharp to `0.35.5`, and the
  `source-map-js` transitive dependency is overridden to `1.2.2`.
- Race To Win: the server now retains only corroborated, unusually uniform
  high-rate lane input patterns for review.  A single weak signal does not
  reject a player or create a financial result.
- Flappy Race: every newly started official session receives a fresh server
  cryptographic seed.  The persisted seed remains the client/server replay
  source of truth; historical sessions are untouched.
- Jumping Race: the deterministic course accepts a server-provided seed; the
  client does not select it.  The pending migration adds that server seed,
  session nonce, verification state, a service-only verification RPC and a
  finalization gate.  The browser only supplies a Cloudflare token; Siteverify
  validates the action and cdata before the service role marks the session
  verified.
- Jumping Race: strictly cross-origin POSTs are rejected, and corroborated
  high-density plus perfectly uniform action streams are retained as
  `pending_review`, not automatically rewarded.
- Browser headers: CSP now limits scripts, frames and connections to the
  application, Cloudflare Turnstile and Supabase; object embedding and framing
  remain blocked.  The policy deliberately retains the inline styles required
  by the current React game overlays.
- Repository hygiene: `supabase/.temp/` is ignored.

## Migration awaiting explicit approval

`supabase/migrations/20261119051142_harden_jumping_race_session_verification.sql`

The migration is additive. It was applied to production as
`20261119051142_harden_jumping_race_session_verification`; it only alters Jumping Race session/result
contracts and function grants.  It does **not** reference balance, ledger,
prize, payout, winner or payment tables.  It also revokes browser execution of
the legacy `jr_hourly_leaderboard` SECURITY DEFINER function, retaining only
service-role access.  Existing sessions retain `verification_required=false`;
new official sessions require verified session-bound evidence.

## Production configuration required before deployment

1. Configure the same Cloudflare widget's production hostname in
   `TURNSTILE_ALLOWED_HOSTNAMES`.
2. Keep `TURNSTILE_ENFORCEMENT_ENABLED=true` and configure both the site and
   secret key.  Add `jumping_race_session_verification` to
   `TURNSTILE_ENABLED_ACTIONS`.
3. Enable Supabase Auth leaked-password protection in the Auth security
   settings.  This is a console setting, not a code or database migration.
4. Retest Cloudflare Siteverify in production with the real hostname after
   deployment.  Tokens, secrets and user identifiers must not be logged.

## Remaining validation limits

- The migration was applied and its production columns and grants were checked
  directly. An authenticated browser flow still needs a real production
  Turnstile test after the release.
- Production Turnstile, Vercel environment values and Cloudflare host settings
  were not changed from this change set.  Their presence and matching widget
  configuration must be confirmed before release.
- Turnstile adds meaningful cost to automation but cannot prove a human is
  playing.  Server replay, rate controls, nonce binding and review signals stay
  necessary.
- `npm audit --omit=dev` reports zero vulnerabilities.  The full development
  dependency graph still reports two high findings through lint-only tooling
  (`zod` and `brace-expansion`) and seven moderate findings.  They are not in
  the production dependency graph; updating that toolchain is tracked as a
  separate compatibility task rather than forcing an unreviewed lint upgrade.
