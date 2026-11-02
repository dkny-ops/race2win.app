-- Shared prize wallet: minimum withdrawal increases to US$20 (2,000 cents).
-- Applies to Race To Win, FlappyRace and future games using the same wallet.
-- Preserve all existing credits, payout records, owner-only payment control and RLS.
-- These replacements preserve the existing audited function bodies and privileges.
DO $migration$
DECLARE f text;
BEGIN
  SELECT pg_get_functiondef('public.rtw_begin_balance_payout_request(uuid)'::regprocedure) INTO f;
  IF position('if v_eligible_cents < 1000' in f) > 0 THEN
    EXECUTE replace(f, 'if v_eligible_cents < 1000', 'if v_eligible_cents < 2000');
  ELSIF position('if v_eligible_cents < 2000' in f) = 0 THEN
    RAISE EXCEPTION 'Unexpected balance payout function; abort';
  END IF;

  SELECT pg_get_functiondef('public.rtw_owner_confirm_full_balance_paid(uuid,uuid,uuid)'::regprocedure) INTO f;
  IF position('v_balance < 1000' in f) > 0 AND position('at least $10' in f) > 0 THEN
    EXECUTE replace(replace(f, 'v_balance < 1000', 'v_balance < 2000'), 'at least $10', 'at least $20');
  ELSIF position('v_balance < 2000' in f) = 0 OR position('at least $20' in f) = 0 THEN
    RAISE EXCEPTION 'Unexpected owner payout function; abort';
  END IF;
END $migration$;
