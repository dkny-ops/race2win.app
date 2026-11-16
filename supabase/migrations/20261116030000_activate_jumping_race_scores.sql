-- Enable nonfinancial Jumping Race competition only after production build and rollback-only RPC checks.
-- This flag controls official sessions; it does not activate prizes, wallets or payouts.
update private.jumping_race_control set enabled = true, updated_at = now()
where singleton = true and enabled = false;
