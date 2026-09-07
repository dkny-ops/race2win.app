import { NextResponse } from "next/server";

import { getVerifiedPlayerId, NO_STORE_HEADERS, RACE_TO_WIN_GAME_SLUG } from "@/lib/competition/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const playerId = await getVerifiedPlayerId();
    if (!playerId) return NextResponse.json({ message: "Sign in to create a referral link." }, { status: 401, headers: NO_STORE_HEADERS });
    if (!isAdminConfigured()) return NextResponse.json({ message: "Referral links are unavailable." }, { status: 503, headers: NO_STORE_HEADERS });

    const { data, error } = await createAdminClient().rpc("rtw_ensure_referral_code", {
      p_player_id: playerId,
      p_game_slug: RACE_TO_WIN_GAME_SLUG,
    });
    if (error || typeof data !== "string") throw error ?? new Error("Unexpected referral response");
    return NextResponse.json({ code: data }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ message: "Referral links are unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
