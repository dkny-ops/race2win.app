import "server-only";

import { createHmac } from "node:crypto";

import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export type OtpAbuseAction = "otp_request" | "otp_verify";
export type OtpAbuseDecision = "allowed" | "blocked" | "unavailable";

const HMAC_HEX = /^[0-9a-f]{64}$/;
const MINIMUM_HMAC_KEY_BYTES = 32;
const GLOBAL_SHARD_COUNT = 64;

type OtpAbuseBuckets = Readonly<{
  emailBucketHmac: string;
  globalShardBucketHmac: string;
}>;

function abuseHmacKey(): string | null {
  const key = process.env.RTW_ABUSE_HMAC_KEY;
  if (!key || Buffer.byteLength(key, "utf8") < MINIMUM_HMAC_KEY_BYTES) return null;
  return key;
}

function hmac(key: string, purpose: string): string {
  return createHmac("sha256", key).update(purpose, "utf8").digest("hex");
}

/**
 * Produces opaque, action-separated buckets. No raw email or client header is
 * persisted or logged. IP bucketing is intentionally absent until a trusted
 * infrastructure-provided source is explicitly configured and audited.
 */
export function deriveOtpAbuseBuckets(action: OtpAbuseAction, email: string): OtpAbuseBuckets | null {
  const key = abuseHmacKey();
  const normalizedEmail = email.trim().toLowerCase();
  if (!key || !normalizedEmail) return null;

  const emailBucketHmac = hmac(key, `rtw:otp-abuse:v1:${action}:email:${normalizedEmail}`);
  const shard = Number.parseInt(emailBucketHmac.slice(0, 8), 16) % GLOBAL_SHARD_COUNT;
  const globalShardBucketHmac = hmac(key, `rtw:otp-abuse:v1:${action}:global-shard:${shard}`);
  if (!HMAC_HEX.test(emailBucketHmac) || !HMAC_HEX.test(globalShardBucketHmac)) return null;
  return { emailBucketHmac, globalShardBucketHmac };
}

/**
 * This always fails closed: an absent/invalid HMAC key, missing service-role
 * setup, or database failure never permits an OTP provider call.
 */
export async function consumeOtpAbuseLimit(action: OtpAbuseAction, email: string): Promise<OtpAbuseDecision> {
  const buckets = deriveOtpAbuseBuckets(action, email);
  if (!buckets || !isAdminConfigured()) return "unavailable";

  try {
    const { data, error } = await createAdminClient().rpc("rtw_consume_pre_auth_otp_rate_limit", {
      p_action: action,
      p_email_bucket_hmac: buckets.emailBucketHmac,
      p_global_shard_bucket_hmac: buckets.globalShardBucketHmac,
    });
    if (error || typeof data !== "boolean") return "unavailable";
    return data ? "allowed" : "blocked";
  } catch {
    return "unavailable";
  }
}
