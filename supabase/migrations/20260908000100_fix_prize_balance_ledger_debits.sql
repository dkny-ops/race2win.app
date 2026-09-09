-- A negative ledger event must debit an existing balance without first
-- constructing a transient negative row. PostgreSQL checks constraints before
-- resolving ON CONFLICT, so the previous UPSERT shape rejected every valid
-- debit (credit reversal or payout hold).
create or replace function private.apply_prize_ledger_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('app.rtw_ledger_write', 'on', true);

  -- Only a positive event can establish a previously absent balance. If it
  -- does, that initial value already includes the event and must not be added
  -- a second time below.
  insert into public.prize_balances (player_id, available_cents, updated_at)
  select new.player_id, new.amount_cents, now()
  where new.amount_cents > 0
  on conflict (player_id) do nothing;
  if found then
    return new;
  end if;

  -- UPDATE takes a row lock and rechecks the predicate after any concurrent
  -- ledger update. A debit can therefore never drive a balance below zero,
  -- while concurrent credits/debits serialize on the player's balance row.
  update public.prize_balances
  set available_cents = available_cents + new.amount_cents,
      updated_at = now()
  where player_id = new.player_id
    and available_cents + new.amount_cents >= 0;

  if not found then
    raise exception 'Ledger debit exceeds the available prize balance.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.apply_prize_ledger_entry() from public, anon, authenticated;
