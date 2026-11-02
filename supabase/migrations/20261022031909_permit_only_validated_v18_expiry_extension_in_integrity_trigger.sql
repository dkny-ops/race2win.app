CREATE OR REPLACE FUNCTION private.protect_game_session_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.game_id is distinct from old.game_id
    or new.gameplay_version is distinct from old.gameplay_version
    or new.seed is distinct from old.seed
    or new.created_at is distinct from old.created_at
    or new.started_at is distinct from old.started_at
        or new.checkpoint_interval_score is distinct from old.checkpoint_interval_score then
    raise exception 'Immutable game session fields cannot be changed.' using errcode = '23514';
  end if;

  if (new.referral_eligible is distinct from old.referral_eligible
      or new.anti_fraud_status is distinct from old.anti_fraud_status)
    and (old.status <> 'active' or new.status <> 'finalized') then
    raise exception 'Server finalization evidence is immutable outside finalization.' using errcode = '23514';
  end if;

  if new.expires_at is distinct from old.expires_at and (
    old.gameplay_version <> 'rtw-v18' or old.status <> 'active'
    or new.status <> 'active'
    or current_setting('rtw.activity_lease_renewal', true) <> 'validated'
    or new.expires_at <= old.expires_at
    or new.expires_at > now() + interval '15 minutes'
  ) then
    raise exception 'Session expiry can only be extended by validated v18 evidence.' using errcode = '23514';
  end if;

  if old.gameplay_version = 'rtw-v6' then
    if new.activity_lease_expires_at is distinct from old.activity_lease_expires_at then
      raise exception 'Immutable game session fields cannot be changed.' using errcode = '23514';
    end if;
    if old.status <> 'active' then
      raise exception 'A completed or invalid session is immutable.' using errcode = '23514';
    end if;
    if new.expires_at is distinct from old.expires_at then
      raise exception 'Immutable game session fields cannot be changed.' using errcode = '23514';
    end if;
    if new.status = 'active' then
      raise exception 'An active session cannot be rewritten.' using errcode = '23514';
    end if;
    if new.status = 'finalized' and new.finalized_at is null then
      raise exception 'A finalized session requires a server finalization time.' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status <> 'active' then
    raise exception 'A completed or invalid session is immutable.' using errcode = '23514';
  end if;

  if new.status = 'active' then
    if current_setting('rtw.activity_lease_renewal', true) <> 'validated'
      or new.activity_lease_expires_at <= old.activity_lease_expires_at
      or new.finalized_at is distinct from old.finalized_at
      or new.invalidated_at is distinct from old.invalidated_at
      or new.invalidation_reason is distinct from old.invalidation_reason
      or new.input_digest is distinct from old.input_digest
      or new.input_count is distinct from old.input_count
      or new.final_score is distinct from old.final_score
      or new.final_distance_millimeters is distinct from old.final_distance_millimeters
      or new.final_elapsed_ms is distinct from old.final_elapsed_ms
      or new.final_collision_at_ms is distinct from old.final_collision_at_ms
      or new.anti_fraud_status is distinct from old.anti_fraud_status then
      raise exception 'An active session lease can only be renewed by validated server evidence.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.activity_lease_expires_at is distinct from old.activity_lease_expires_at then
    raise exception 'Only an active session lease may be renewed.' using errcode = '23514';
  end if;
  if new.status = 'finalized' and new.finalized_at is null then
    raise exception 'A finalized session requires a server finalization time.' using errcode = '23514';
  end if;
  return new;
end;
$function$
;;
