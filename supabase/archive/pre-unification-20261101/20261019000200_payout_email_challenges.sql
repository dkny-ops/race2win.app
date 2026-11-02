-- Server-owned, short-lived email verification challenges for manual payout review.
-- No browser role can read the digest or mutate a challenge.
create table if not exists public.payout_email_challenges (
  payout_id uuid primary key references public.payouts(id) on delete restrict,
  code_digest text not null check (length(code_digest) = 64),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  verified_at timestamptz,
  issued_by uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz not null default now(),
  constraint payout_email_challenge_valid_expiry check (expires_at > issued_at)
);
alter table public.payout_email_challenges enable row level security;
revoke all on public.payout_email_challenges from public, anon, authenticated;
grant select, insert, update on public.payout_email_challenges to service_role;
comment on table public.payout_email_challenges is 'Server-only payout email challenge. Digest is HMAC-SHA256 with secret kept in server environment. No plaintext code persisted.';
