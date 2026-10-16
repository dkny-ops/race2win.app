# Preview release preflight

This document prepares a **local release candidate only**. It does not authorize
any database write, Vercel deployment, push, or Production change.

## Weekly release migration set

The release candidate keeps all historical migrations through
`20261010032418_fix_finalize_expired_lease_status.sql`, then requires this
forward-only chain:

1. `20261011000100_gate_referral_days_on_replay_evidence.sql`
2. `20261013175035_weekly_antifraud_review_gate.sql`
3. `20261013212406_add_weekly_leader_human_verification.sql`
4. `20261014034008_enforce_official_hourly_play_allowances_and_retire_share_rewards.sql`

The seven hourly-demo experiment migrations from `20261012155258` through
`20261013030000` were intentionally removed from this weekly-only release
candidate before any remote application. They are not part of its migration
chain and must not be recreated or applied to a weekly environment.

`npm run test:preview-db` proves locally that the historical plus weekly chain
installs into a fresh PGlite database without those experiments. It is not a
substitute for PostgreSQL/Supabase validation.

## Required Preview environment

Use a dedicated Supabase Preview project. Never copy Production credentials.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RTW_ABUSE_HMAC_KEY`
- `TURNSTILE_ENFORCEMENT_ENABLED`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `TURNSTILE_ALLOWED_HOSTNAMES`
- `TURNSTILE_ENABLED_ACTIONS`

For a real leader verification test, Turnstile must be explicitly enabled and
configured with the exact Preview hostname and the
`weekly_leader_verification` action. Do not disable enforcement to bypass an
incomplete widget configuration. Leave ad SSV configuration absent: rewarded
plays remain unavailable.

## Owner-authorized remote sequence

1. Confirm in Vercel that Production Branch is `main` and that the release
   branch creates only a Preview deployment.
2. Confirm the Supabase project reference is the dedicated Preview project.
3. Read its migration history; it must match the historical baseline before
   any write.
4. Create a reviewed commit containing the weekly migration set and excluding
   `supabase/.temp/`.
5. Apply the approved migration chain once, then verify grants, RLS, RPCs and
   the five-play allowance on the Preview database.
6. Test the Preview manually on desktop and iPhone with test identities only.

No payment, payout, balance credit, Share reward, or advertisement provider is
part of this release procedure.
