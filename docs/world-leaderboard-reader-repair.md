# WORLD leaderboard restricted reader repair

Observed on 2026-10-17 against main a341ab7 and the app database lndvnufmbuzdbinapvze.

The public https://racetowin.app/api/leaderboard?page=1&pageSize=50 returned HTTP 500, X-Vercel-Cache MISS, with the generic unavailable message. Current-week recomputation from valid daily top-seven runs and weekly_tournament_totals both returned 5418. The ranked player has a public username.

readLeaderboard queried profiles directly with service_role. Production intentionally denies that role SELECT on every profiles column, including user_id and username. The table contains private payout contact information. This denial is part of the existing hardening migration and must remain intact.

Production already provides rtw_read_public_leaderboard_page_metadata(uuid,date,integer,integer), a STABLE function with an empty search_path and EXECUTE restricted to postgres and service_role. It validates Monday/week and page bounds, joins only ranked public usernames, returns rank/username/weekly_total_score and a total public count, and performs no mutations. A direct read returned rank 1 and 5418 points, matching the stored total.

The application now uses that existing reader. Public rows are paginated inside the database, and empty pages retain correct continuation metadata. No permissions, schema, verification status, scores, or prize data are changed. No production migrations are needed. The repository migration history still lacks several functions already deployed remotely; do not replay or reset it.

Regression tests deny all direct table access except the games lookup and require the exact restricted RPC and scoped arguments. They cover numeric mapping, private-profile pagination, empty/out-of-range pages, the page cap, and database errors without fallback. The existing verification and authorization tests remain in place.

Deployment uses the existing GitHub/Vercel integration. Vercel MCP returned 403 for dknyteam and local CLI has no credentials, so independent control-plane inspection is unavailable. Verify the Git commit status and the public endpoint after release. No player challenge completion is performed by this repair.
