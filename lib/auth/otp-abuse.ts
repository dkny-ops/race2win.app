import "server-only";
import { createHmac } from "node:crypto";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export type OtpAbuseAction = "otp_request" | "otp_verify";

/** Opaque buckets match the existing service-only production RPC. */
export function deriveOtpAbuseBuckets(action: OtpAbuseAction, email: string) {
  const key = process.env.RTW_ABUSE_HMAC_KEY;
  const normalized = email.trim().toLowerCase();
  if (!key || Buffer.byteLength(key, "utf8") < 32 || !normalized) return null;
  const hmac = (value: string) => createHmac("sha256", key).update(value, "utf8").digest("hex");
  const emailBucketHmac = hmac(`rtw:otp-abuse:v1:${action}:email:${normalized}`);
  const shard = Number.parseInt(emailBucketHmac.slice(0, 8), 16) % 64;
  return { emailBucketHmac, globalShardBucketHmac: hmac(`rtw:otp-abuse:v1:${action}:global-shard:${shard}`) };
}

/** Shared atomic quotas expire automatically; never impose an account hold. */
export async function consumeOtpAbuseLimit(action: OtpAbuseAction, email: string): Promise<"allowed" | "blocked" | "unavailable"> {
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
  } catch { return "unavailable"; }
}
