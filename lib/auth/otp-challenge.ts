import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OTP_CHALLENGE_COOKIE = "rtw_otp_challenge";
const LIFETIME_MS = 600_000;

function key(): string | null {
  const value = process.env.RTW_ABUSE_HMAC_KEY;
  return value && Buffer.byteLength(value, "utf8") >= 32 ? value : null;
}

function signature(secret: string, email: string, payload: string): Buffer {
  return createHmac("sha256", secret)
    .update(JSON.stringify(["rtw:otp-challenge:v1", email.trim().toLowerCase(), payload]))
    .digest();
}

/** Issued only after a rate-limited OTP request accepted by the provider. */
export function issueOtpChallenge(email: string, now = Date.now()): string | null {
  const secret = key();
  if (!secret || !email || !Number.isSafeInteger(now)) return null;
  const payload = `${now}.${randomBytes(16).toString("hex")}`;
  return `${payload}.${signature(secret, email, payload).toString("hex")}`;
}

/** Admission only: this never authenticates a user or bypasses the DB limiter. */
export function verifyOtpChallenge(email: string, challenge: unknown, now = Date.now()): boolean {
  const secret = key();
  if (!secret || !email || typeof challenge !== "string" || challenge.length > 120) return false;
  const match = /^(\d{13})\.([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(challenge);
  if (!match) return false;
  const issuedAt = Number(match[1]);
  if (!Number.isSafeInteger(now) || issuedAt > now || now - issuedAt >= LIFETIME_MS) return false;
  return timingSafeEqual(Buffer.from(match[3], "hex"), signature(secret, email, `${match[1]}.${match[2]}`));
}
