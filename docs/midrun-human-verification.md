# Midrun human verification

Race To Win official sessions receive a server-owned randomized challenge scheduled 90–150 seconds after the authoritative session start.

The browser polls `/api/game-sessions/human-check`. Once due, the player selects the requested symbol and Cloudflare Turnstile executes in invisible mode. The server verifies Cloudflare Siteverify action and hostname, then atomically marks the matching challenge verified.

The database trigger retains scores for review when the challenge was due before the authoritative collision time but was not verified. Sessions that crash before the challenge becomes due are not penalized.

Production configuration: `TURNSTILE_ENFORCEMENT_ENABLED=true`, `TURNSTILE_MIDRUN_ENABLED=true`, existing public site key, private secret, and allowed hostnames. Never put the private secret in a browser variable.

This challenge is an additional bot deterrent, not proof of human play. Monitor completion and false positives before using it as a prize-eligibility gate.
