# Midrun human verification

Race To Win official sessions receive a server-owned randomized challenge scheduled 60–100 seconds after the authoritative session start, followed by another challenge every 100 seconds (160–200, 260–300, and so on) until the session ends. Each verified challenge is stored in private history and the next one is scheduled atomically.

The browser polls `/api/game-sessions/human-check`. Once due, the player selects the requested symbol and Cloudflare Turnstile executes in invisible mode. The server verifies Cloudflare Siteverify action and hostname, then atomically records the successful verification and schedules the next challenge.

The database trigger retains scores for review when the challenge was due before the authoritative collision time but was not verified. Sessions that crash before the challenge becomes due are not penalized.

Production configuration: `TURNSTILE_ENFORCEMENT_ENABLED=true`, `TURNSTILE_MIDRUN_ENABLED=true`, existing public site key, private secret, and allowed hostnames. Never put the private secret in a browser variable.

This challenge is an additional bot deterrent, not proof of human play. Monitor completion and false positives before using it as a prize-eligibility gate.
