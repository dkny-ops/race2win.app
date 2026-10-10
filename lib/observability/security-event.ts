import "server-only";

/**
 * A deliberately small server-only event schema. Values are selected by the
 * route implementation; request bodies, headers, identities, and provider
 * errors are never accepted as logging metadata.
 */
export type SecurityEventType =
  | "auth.request_code.rejected"
  | "auth.request_code.failed"
  | "auth.verify_code.rejected"
  | "auth.verify_code.failed"
  | "auth.sign_out.failed"
  | "profile.access.rejected"
  | "profile.operation.failed"
  | "game_session.start.rejected"
  | "game_session.start.failed"
  | "game_session.finalize.rejected"
  | "game_session.finalize.failed"
  | "game_session.anti_cheat_rejected"
  | "game_session.checkpoint.rejected"
  | "game_session.checkpoint.failed"
  | "scores.me.rejected"
  | "scores.me.failed"
  | "leaderboard.rejected"
  | "leaderboard.failed"
  | "referral.code.rejected"
  | "referral.code.failed"
  | "referral.attach.rejected"
  | "referral.attach.failed"
  | "prize.claim.rejected"
  | "prize.claim.failed"
  | "balance_claim.rejected"
  | "balance_claim.failed"
  | "payout_hold.operation_failed";

export type SecurityEventRoute =
  | "/api/auth/request-code"
  | "/api/auth/verify-code"
  | "/api/auth/sign-out"
  | "/api/profile"
  | "/api/game-sessions/start"
  | "/api/game-sessions/finalize"
  | "/api/game-sessions/checkpoint"
  | "/api/scores/me"
  | "/api/leaderboard"
  | "/api/referrals/code"
  | "/api/referrals/attach"
  | "/api/prizes/claimable"
  | "/api/prizes/claim"
  | "/api/prizes/balance-claim";

export type SecurityEventReason =
  | "invalid_request"
  | "unauthenticated"
  | "rate_limited"
  | "abuse_protection_unavailable"
  | "missing_configuration"
  | "provider_rejected"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "leaderboard_game_unavailable"
  | "leaderboard_totals_unavailable"
  | "leaderboard_profiles_unavailable"
  | "session_not_found"
  | "session_not_active"
  | "gameplay_version_rejected"
  | "replay_rejected"
  | "finalize_conflict"
  | "authorization_rejected"
  | "eligibility_rejected"
  | "database_operation_failed"
  | "finalize_sql_ambiguity"
  | "unexpected_response"
  | "unexpected_error";

export type SecurityEvent = Readonly<{
  eventType: SecurityEventType;
  route: SecurityEventRoute;
  requestId: string;
  reason: SecurityEventReason;
  status: number;
}>;

/** Generated on the server; never derived from a client header or payload. */
export function createSecurityRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Serializes only the allowlisted event fields. Extra properties, including
 * secrets accidentally attached by a future caller, are not emitted.
 */
export function formatSecurityEvent(event: SecurityEvent): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    eventType: event.eventType,
    route: event.route,
    requestId: event.requestId,
    reason: event.reason,
    status: event.status,
  });
}

/**
 * Vercel captures stdout/stderr for server-side Route Handlers. This emits no
 * client response and must only be called after a server decision is made.
 */
export function logSecurityEvent(event: SecurityEvent): void {
  const record = formatSecurityEvent(event);
  if (event.status >= 500) {
    console.error(record);
    return;
  }
  console.warn(record);
}
