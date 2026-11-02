-- Atomic, server-only issuance and owner attestation.
-- Verification here means the administrator attests to matching the code received
-- via WhatsApp with the code they emailed. The server cannot independently
-- authenticate that out-of-band message.
create or replace function public.rtw_admin_issue_payout_challenge(
  p_actor_user_id uuid, p_payout_id uuid, p_digest text
) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare v_status text; v_previous public.payout_email_challenges%rowtype; v_expiry timestamptz;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if not exists (select 1 from private.admin_users where user_id=p_actor_user_id and is_active)
    then raise exception 'Admin required' using errcode='42501'; end if;
  if p_digest !~ '^[0-9a-f]{64}$' then raise exception 'Invalid digest' using errcode='22023'; end if;
  select status into v_status from public.payouts where id=p_payout_id for update;
  if v_status not in ('requested','under_review') then raise exception 'Not eligible' using errcode='22023'; end if;
  select * into v_previous from public.payout_email_challenges where payout_id=p_payout_id for update;
  if found and (v_previous.verified_at is not null or v_previous.expires_at > now())
    then raise exception 'Challenge already issued' using errcode='23505'; end if;
  v_expiry := now() + interval '15 minutes';
  insert into public.payout_email_challenges
    (payout_id,code_digest,expires_at,issued_by,issued_at,verified_at,attempts)
  values (p_payout_id,p_digest,v_expiry,p_actor_user_id,now(),null,0)
  on conflict (payout_id) do update
    set code_digest=excluded.code_digest,expires_at=excluded.expires_at,
        issued_by=excluded.issued_by,issued_at=excluded.issued_at,
        verified_at=null,attempts=0;
  return v_expiry;
end;
$$;
revoke all on function public.rtw_admin_issue_payout_challenge(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.rtw_admin_issue_payout_challenge(uuid,uuid,text) to service_role;

create table if not exists public.payout_email_attestations (
  payout_id uuid primary key references public.payouts(id) on delete restrict,
  attested_by uuid not null references auth.users(id) on delete restrict,
  attested_at timestamptz not null default now(),
  attestation_method text not null default 'owner_compared_email_code_with_whatsapp'
);
alter table public.payout_email_attestations enable row level security;
revoke all on public.payout_email_attestations from public,anon,authenticated;
grant select on public.payout_email_attestations to service_role;

create or replace function public.rtw_admin_attest_payout_email(
  p_actor_user_id uuid, p_payout_id uuid
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_status text; v_challenge public.payout_email_challenges%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if not exists (select 1 from private.admin_users where user_id=p_actor_user_id and is_active)
    then raise exception 'Admin required' using errcode='42501'; end if;
  select status into v_status from public.payouts where id=p_payout_id for update;
  if v_status not in ('requested','under_review') then raise exception 'Not eligible' using errcode='22023'; end if;
  select * into v_challenge from public.payout_email_challenges where payout_id=p_payout_id for update;
  if not found or v_challenge.expires_at <= now() or v_challenge.verified_at is not null
    then raise exception 'No active challenge' using errcode='22023'; end if;
  update public.payout_email_challenges set verified_at=now() where payout_id=p_payout_id;
  insert into public.payout_email_attestations(payout_id,attested_by)
    values (p_payout_id,p_actor_user_id) on conflict do nothing;
  return true;
end;
$$;
revoke all on function public.rtw_admin_attest_payout_email(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rtw_admin_attest_payout_email(uuid,uuid) to service_role;
