import { ROUTES } from "@/lib/routes";

/**
 * Only the official-game return route is accepted after OTP verification.
 * This intentionally rejects arbitrary client-provided URLs and open redirects.
 */
export function safePostAuthPath(value: unknown): string {
  return value === ROUTES.raceToWinGame ? ROUTES.raceToWinGame : ROUTES.home;
}
