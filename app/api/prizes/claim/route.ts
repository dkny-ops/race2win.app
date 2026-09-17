import { NextResponse } from "next/server";

import {
  consumeCompetitionActionRateLimit,
  getVerifiedPlayerId,
  getWhatsAppClaimUrl,
  isUuid,
  NO_STORE_HEADERS,
  readBoundedJson,
} from "@/lib/competition/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";

export const runtime = "nodejs";

function parseWinnerId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 1 && isUuid(body.winnerId) ? body.winnerId : null;
}

export async function POST(request: Request) {
  const requestId = createSecurityRequestId();
  try {
    const winnerId = parseWinnerId(await readBoundedJson(request));
    if (!winnerId) {
      logSecurityEvent({ eventType: "prize.claim.rejected", route: "/api/prizes/claim", requestId, reason: "invalid_request", status: 400 });
      return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const playerId = await getVerifiedPlayerId();
    if (!playerId) {
      logSecurityEvent({ eventType: "prize.claim.rejected", route: "/api/prizes/claim", requestId, reason: "unauthenticated", status: 401 });
      return NextResponse.json({ message: "Sign in to claim a prize." }, { status: 401, headers: NO_STORE_HEADERS });
    }
    if (!isAdminConfigured() || !getWhatsAppClaimUrl()) {
      logSecurityEvent({ eventType: "prize.claim.failed", route: "/api/prizes/claim", requestId, reason: "missing_configuration", status: 503 });
      return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
    }

    const allowed = await consumeCompetitionActionRateLimit(playerId, "prize_claim");
    if (allowed === false) {
      logSecurityEvent({ eventType: "prize.claim.rejected", route: "/api/prizes/claim", requestId, reason: "rate_limited", status: 429 });
      return NextResponse.json({ message: "Please wait before trying another claim." }, { status: 429, headers: NO_STORE_HEADERS });
    }
    if (allowed === null) {
      logSecurityEvent({ eventType: "prize.claim.failed", route: "/api/prizes/claim", requestId, reason: "database_operation_failed", status: 503 });
      return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
    }

    const { data, error } = await createAdminClient().rpc("rtw_begin_prize_claim", {
      p_player_id: playerId,
      p_winner_id: winnerId,
    });
    if (error || data !== true) {
      logSecurityEvent({ eventType: "prize.claim.rejected", route: "/api/prizes/claim", requestId, reason: "eligibility_rejected", status: 409 });
      return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 409, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json({ claimStarted: true, whatsappUrl: getWhatsAppClaimUrl() }, { headers: NO_STORE_HEADERS });
  } catch {
    logSecurityEvent({ eventType: "prize.claim.failed", route: "/api/prizes/claim", requestId, reason: "unexpected_error", status: 500 });
    return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
