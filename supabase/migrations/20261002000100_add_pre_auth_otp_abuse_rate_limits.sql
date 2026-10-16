-- Pre-authentication OTP abuse controls. Bucket values are server-derived
-- HMACs only; this schema never stores raw email addresses, OTP values, IPs,
-- cookies, or browser identifiers.
create table private.pre_auth_otp_rate_limit_policies (
  action text not null check (action in ('otp_request', 'otp_verify')),
  scope text not null check (scope in ('email', 'global_shard')),
  window_seconds integer not null check (window_seconds between 30 and 3600),
  request_limit integer not null check (request_limit between 1 and 10000),
  retention_seconds integer not null check (retention_seconds between 300 and 2592000),
  primary key (action, scope)
);

-- These are deliberately conservative starting values, not product rules.
-- The sharded shared budget prevents one source from denying OTP service to
-- every address while still bounding provider work under broad abuse.
insert into private.pre_auth_otp_rate_limit_policies (
  action, scope, window_seconds, request_limit, retention_seconds
) values
  ('otp_request', 'email', 60, 3, 300),
  ('otp_request', 'global_shard', 60, 30, 300),
  ('otp_verify', 'email', 60, 5, 300),
  ('otp_verify', 'global_shard', 60, 60, 300);

create table private.pre_auth_otp_rate_limits (
  action text not null check (action in ('otp_request', 'otp_verify')),
  scope text not null check (scope in ('email', 'global_shard')),
  bucket_hmac text not null check (bucket_hmac ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (action, scope, bucket_hmac)
);

create index pre_auth_otp_rate_limits_expiry_idx
  on private.pre_auth_otp_rate_limits (expires_at);

alter table private.pre_auth_otp_rate_limit_policies enable row level security;
alter table private.pre_auth_otp_rate_limits enable row level security;
revoke all on table private.pre_auth_otp_rate_limit_policies from public, anon, authenticated;
revoke all on table private.pre_auth_otp_rate_limits from public, anon, authenticated;

-- Every caller locks its deterministic global shard and then its email
-- bucket. This fixed order avoids deadlocks while INSERT .. ON CONFLICT
-- serializes concurrent attempts for each bucket across application instances.
create function public.rtw_consume_pre_auth_otp_rate_limit(
  p_action text,
  p_email_bucket_hmac text,
  p_global_shard_bucket_hmac text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_email_policy private.pre_auth_otp_rate_limit_policies%rowtype;
  v_global_policy private.pre_auth_otp_rate_limit_policies%rowtype;
  v_window timestamptz;
  v_count integer;
  v_global_count integer;
begin
  if p_action is null
    or p_email_bucket_hmac is null
    or p_global_shard_bucket_hmac is null
    or p_action not in ('otp_request', 'otp_verify')
    or p_email_bucket_hmac !~ '^[0-9a-f]{64}$'
    or p_global_shard_bucket_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid pre-authentication rate-limit request.' using errcode = '22023';
  end if;

  select * into v_email_policy
  from private.pre_auth_otp_rate_limit_policies
  where action = p_action and scope = 'email';
  select * into v_global_policy
  from private.pre_auth_otp_rate_limit_policies
  where action = p_action and scope = 'global_shard';
  if not found or v_email_policy.action is null or v_global_policy.action is null then
    raise exception 'Pre-authentication rate-limit policy is unavailable.' using errcode = 'P0002';
  end if;

  -- Bounded opportunistic cleanup: it touches only this isolated abuse table,
  -- never competition, financial, player, or Auth records.
  with stale as (
    select ctid
    from private.pre_auth_otp_rate_limits
    where expires_at < v_now
    order by expires_at
    limit 100
    for update skip locked
  )
  delete from private.pre_auth_otp_rate_limits as bucket
  using stale
  where bucket.ctid = stale.ctid;

  -- Admit against the sharded shared budget first. Rejected traffic therefore
  -- cannot create an unbounded number of distinct email buckets.
  v_window := to_timestamp(
    floor(extract(epoch from v_now) / v_global_policy.window_seconds) * v_global_policy.window_seconds
  );
  insert into private.pre_auth_otp_rate_limits as bucket (
    action, scope, bucket_hmac, window_started_at, request_count, expires_at, updated_at
  ) values (
    p_action, 'global_shard', p_global_shard_bucket_hmac, v_window, 1,
    v_window + make_interval(secs => v_global_policy.retention_seconds), v_now
  ) on conflict (action, scope, bucket_hmac) do update set
    window_started_at = case when bucket.window_started_at = excluded.window_started_at then bucket.window_started_at else excluded.window_started_at end,
    request_count = case when bucket.window_started_at = excluded.window_started_at then bucket.request_count + 1 else 1 end,
    expires_at = excluded.expires_at,
    updated_at = v_now
  returning request_count into v_global_count;
  if v_global_count > v_global_policy.request_limit then return false; end if;

  v_window := to_timestamp(
    floor(extract(epoch from v_now) / v_email_policy.window_seconds) * v_email_policy.window_seconds
  );
  insert into private.pre_auth_otp_rate_limits as bucket (
    action, scope, bucket_hmac, window_started_at, request_count, expires_at, updated_at
  ) values (
    p_action, 'email', p_email_bucket_hmac, v_window, 1,
    v_window + make_interval(secs => v_email_policy.retention_seconds), v_now
  ) on conflict (action, scope, bucket_hmac) do update set
    window_started_at = case when bucket.window_started_at = excluded.window_started_at then bucket.window_started_at else excluded.window_started_at end,
    request_count = case when bucket.window_started_at = excluded.window_started_at then bucket.request_count + 1 else 1 end,
    expires_at = excluded.expires_at,
    updated_at = v_now
  returning request_count into v_count;
  if v_count <= v_email_policy.request_limit then return true; end if;

  -- The global-row lock acquired above remains held for this transaction, so
  -- an email-only rejection cannot consume shared capacity or race a retry.
  update private.pre_auth_otp_rate_limits as bucket
  set request_count = greatest(bucket.request_count - 1, 0), updated_at = v_now
  where bucket.action = p_action
    and bucket.scope = 'global_shard'
    and bucket.bucket_hmac = p_global_shard_bucket_hmac
    and bucket.window_started_at = to_timestamp(
      floor(extract(epoch from v_now) / v_global_policy.window_seconds) * v_global_policy.window_seconds
    );
  return false;
end;
$$;

alter function public.rtw_consume_pre_auth_otp_rate_limit(text, text, text) owner to postgres;
revoke all on function public.rtw_consume_pre_auth_otp_rate_limit(text, text, text) from public, anon, authenticated;
grant execute on function public.rtw_consume_pre_auth_otp_rate_limit(text, text, text) to service_role;
