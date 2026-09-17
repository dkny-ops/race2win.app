import { NextResponse } from "next/server";

import {
  consumeCompetitionActionRateLimit,
  getVerifiedPlayerId,
  getWhatsAppClaimUrl,
  hasEmptyBoundedBody,
  NO_STORE_HEADERS,
} from "@/lib/competition/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createSecurityRequestId();
  try {
    if (!(await hasEmptyBoundedBody(request))) {
      logSecurityEvent({ eventType: "balance_claim.rejected", route: "/api/prizes/balance-claim", requestId, reason: "invalid_request", status: 400 });
      return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const playerId = await getVerifiedPlayerId();
    if (!playerId) {
      logSecurityEvent({ eventType: "balance_claim.rejected", route: "/api/prizes/balance-claim", requestId, reason: "unauthenticated", status: 401 });
      return NextResponse.json({ message: "Sign in to claim a prize balance." }, { status: 401, headers: NO_STORE_HEADERS });
    }
    if (!isAdminConfigured() || !getWhatsAppClaimUrl()) {
      logSecurityEvent({ eventType: "balance_claim.failed", route: "/api/prizes/balance-claim", requestId, reason: "missing_configuration", status: 503 });
      return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
    }

    const allowed = await consumeCompetitionActionRateLimit(playerId, "balance_claim");
    if (allowed === false) {
      logSecurityEvent({ eventType: "balance_claim.rejected", route: "/api/prizes/balance-claim", requestId, reason: "rate_limited", status: 429 });
      return NextResponse.json({ message: "Please wait before trying another claim." }, { status: 429, headers: NO_STORE_HEADERS });
    }
    if (allowed === null) {
      logSecurityEvent({ eventType: "balance_claim.failed", route: "/api/prizes/balance-claim", requestId, reason: "database_operation_failed", status: 503 });
      return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
    }

    const { data, error } = await createAdminClient().rpc("rtw_begin_balance_payout_request", { p_player_id: playerId });
    if (error || typeof data !== "string") {
      logSecurityEvent({ eventType: "payout_hold.operation_failed", route: "/api/prizes/balance-claim", requestId, reason: "eligibility_rejected", status: 409 });
      return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 409, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json({ payoutRequestId: data, whatsappUrl: getWhatsAppClaimUrl() }, { headers: NO_STORE_HEADERS });
  } catch {
    logSecurityEvent({ eventType: "balance_claim.failed", route: "/api/prizes/balance-claim", requestId, reason: "unexpected_error", status: 500 });
    return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
