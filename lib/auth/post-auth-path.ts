import { ROUTES } from "@/lib/routes";

/**
 * Only the official-game return route is accepted after OTP verification.
 * This intentionally rejects arbitrary client-provided URLs and open redirects.
 */
export function safePostAuthPath(value: unknown): string {
  if (value === ROUTES.raceToWinGame) return ROUTES.raceToWinGame;
  // A bounded, internal referral landing is the only query-bearing return
  // path. It preserves a public referral code without becoming an open redirect.
  if (typeof value === "string" && /^\/\?ref=[A-Z0-9]{10,32}$/.test(value)) return value;
  return ROUTES.home;
}
