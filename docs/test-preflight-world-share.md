# TEST preflight: World Players and Weekly Share Challenge

This procedure is intentionally **not executable by deployment automation**. It
is a review checklist for a later, explicitly authorized TEST-only validation.
It never targets Production (`fspszgqmwhwfoiitnerp`).

## 1. Stop conditions before any TEST write

1. From the audit worktree, confirm `supabase/.temp/project-ref` is exactly
   `lndvnufmbuzdbinapvze`.
2. Run `supabase migration list` and preserve the output with secrets redacted.
3. Run `supabase db push --dry-run`. Stop if it lists any migration other than
   the explicitly approved leaderboard/Share migrations. Do not use migration
   repair, `db reset`, ad-hoc SQL, or a Production link.
4. Obtain approval before creating any disposable TEST identity or official run.
   The tests must use a non-production, isolated competition week and must not
   invoke award approval, payout, balance-claim, or payment operations.

## 2. Database permission and projection checks

Run as a controlled TEST database administrator and capture only PASS/FAIL
results (never result rows containing player identifiers):

- `anon` and `authenticated` cannot execute
  `rtw_read_ranked_public_usernames`, `rtw_read_public_leaderboard_page`, or
  `rtw_read_weekly_share_leaderboard`.
- `service_role` can execute each projection, and each result contains only its
  documented allowlist. The World Players projection returns rank, username,
  weekly total, and an internal pagination count; no player id, email, tie-break
  vector, replay, financial, or payout field crosses the HTTP response.
- `anon` and `authenticated` retain no direct `SELECT` privilege on
  `public.profiles`, `public.weekly_tournament_totals`,
  `public.weekly_share_results`, checkpoints, ledger, balances, prizes, or
  payouts. RLS remains enabled on the protected tables.
- Call each read projection with null, non-Monday week, out-of-range page, and
  out-of-range limit inputs; each must reject without modifying data.

The following **read-only** catalog checks are suitable for an approved TEST
administrator session. They intentionally return permission booleans rather
than player data:

```sql
select
  has_function_privilege('anon', 'public.rtw_read_public_leaderboard_page(uuid,date,integer,integer)', 'EXECUTE') as anon_world,
  has_function_privilege('authenticated', 'public.rtw_read_public_leaderboard_page(uuid,date,integer,integer)', 'EXECUTE') as authenticated_world,
  has_function_privilege('service_role', 'public.rtw_read_public_leaderboard_page(uuid,date,integer,integer)', 'EXECUTE') as service_world,
  has_function_privilege('anon', 'public.rtw_read_weekly_share_leaderboard(uuid,date,integer)', 'EXECUTE') as anon_share,
  has_function_privilege('authenticated', 'public.rtw_read_weekly_share_leaderboard(uuid,date,integer)', 'EXECUTE') as authenticated_share,
  has_function_privilege('service_role', 'public.rtw_read_weekly_share_leaderboard(uuid,date,integer)', 'EXECUTE') as service_share,
  has_table_privilege('anon', 'public.profiles', 'SELECT') as anon_profiles,
  has_table_privilege('authenticated', 'public.profiles', 'SELECT') as authenticated_profiles;

select n.nspname, c.relname, c.relrowsecurity
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where (n.nspname, c.relname) in (
  ('public', 'profiles'), ('public', 'weekly_tournament_totals'),
  ('public', 'weekly_share_results'), ('private', 'game_session_checkpoints')
)
order by n.nspname, c.relname;

select lower(username) as normalized_username, count(*) as duplicate_count
from public.profiles
where username is not null
group by lower(username)
having count(*) > 1;

select indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public' and tablename = 'profiles'
  and indexname = 'profiles_username_lower_key';
```

Expected values: both `anon_*` and `authenticated_*` function permissions are
false, both profile privileges are false, both `service_*` permissions are
true, and every listed protected table has RLS enabled. Record only PASS/FAIL;
do not export live ranking rows during this permission check.
The duplicate query must return zero rows before relying on the existing
case-insensitive unique index; it is a preflight observation only and must not
rename or delete any profile automatically.

## 3. Official-score validation (isolated TEST fixture)

With a specifically authorized disposable authenticated TEST player:

1. Use the real HTTP protocol: START -> ordered server-validated checkpoints ->
   FINALIZE. Do not insert runs, totals, or checkpoint rows manually.
2. Exercise one replay that legitimately exceeds ten minutes and 10,000 points.
   The deterministic evidence must be replayed by the server, with no supplied
   authority for score, elapsed time, distance, seed, or lease.
3. Verify exactly one validated run for the finalized session; exact finalization
   retry returns the canonical result and altered retry is rejected.
4. Verify daily Top 7 and the New York-week total only after the validated run.
   A guest/local result must not appear in the database or World Players.
5. Call `/api/scores/me` and `/api/leaderboard` and verify the public ranking
   pages have no gaps caused by hidden/missing usernames, stable tie ordering,
   correct `hasNextPage`, and only allowlisted fields.

## 4. Referral and Share validation (separate authorized TEST fixture)

1. Create two disposable, verified TEST users only after approval. Attach the
   referral via the authenticated HTTP endpoint, not table writes.
2. Retry the exact attachment and expect idempotency. Attempt self-attribution,
   another inviter after attachment, and client-supplied confirmed-count/status;
   all must be rejected or ignored without changing confirmation state.
3. Complete the established server-validated activity criteria in the correct
   New York week. Confirm that only server-confirmed referrals populate
   `weekly_share_results` and that the Top 10 projection preserves deterministic
   rank/tie order.
4. Test tied leading confirmed counts in a dedicated TEST week. Award generation
   may be inspected only. Do not transition an award to approval, create a
   balance credit, create a hold, request a payout, or make a payment. Confirm
   the fixed $10 allocation is server-derived and requires the existing human
   approval before payment.

## 5. Evidence and cleanup

Record sanitized request outcomes, migration versions, row-count deltas, and
permission outcomes. Do not log emails, user ids, tokens, replay evidence, or
credentials. Preserve fraud/rate-limit/security evidence; delete fixtures only
with separate authorization and only after positively identifying ownership.
