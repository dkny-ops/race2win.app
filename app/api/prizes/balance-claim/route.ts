import { NextResponse } from "next/server";

import {
  consumeCompetitionActionRateLimit,
  getVerifiedPlayerId,
  getWhatsAppClaimUrl,
  hasEmptyBoundedBody,
  NO_STORE_HEADERS,
} from "@/lib/competition/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!(await hasEmptyBoundedBody(request))) {
      return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const playerId = await getVerifiedPlayerId();
    if (!playerId) return NextResponse.json({ message: "Sign in to claim a prize balance." }, { status: 401, headers: NO_STORE_HEADERS });
    if (!isAdminConfigured() || !getWhatsAppClaimUrl()) return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 503, headers: NO_STORE_HEADERS });

    const allowed = await consumeCompetitionActionRateLimit(playerId, "balance_claim");
    if (allowed === false) return NextResponse.json({ message: "Please wait before trying another claim." }, { status: 429, headers: NO_STORE_HEADERS });
    if (allowed === null) return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 503, headers: NO_STORE_HEADERS });

    const { data, error } = await createAdminClient().rpc("rtw_begin_balance_payout_request", { p_player_id: playerId });
    if (error || typeof data !== "string") return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 409, headers: NO_STORE_HEADERS });
    return NextResponse.json({ payoutRequestId: data, whatsappUrl: getWhatsAppClaimUrl() }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ message: "Prize claim is unavailable." }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
