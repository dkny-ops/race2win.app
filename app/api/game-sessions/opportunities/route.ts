import { recordAuth401, isGameAccessHeld, REVIEW_MESSAGE } from "@/lib/security/auth-401-review";
import { NextResponse } from "next/server";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RACE_TO_WIN_GAME_SLUG } from "@/lib/routes";

export const runtime = "nodejs";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const context = await getVerifiedUserContext();
    if (!context) {
      const reference = await recordAuth401("/api/game-sessions/opportunities", "unauthenticated");
      return NextResponse.json({ message: REVIEW_MESSAGE, reference }, { status: 401, headers });
    }
    if (await isGameAccessHeld(context.userId)) return NextResponse.json({ message: REVIEW_MESSAGE, reviewRequired: true }, { status: 403, headers });
    const admin = createAdminClient();
    const { data: game, error: gameError } = await admin.from("games").select("id").eq("slug", RACE_TO_WIN_GAME_SLUG).single();
    if (gameError || !game) throw new Error("Game unavailable");
    // Calculate the New York wall-clock hour boundaries with the database's timezone rules.
    // Count every created official session, including failed/expired ones; the start RPC is authoritative.
    const { data, error } = await admin.rpc("rtw_read_hourly_opportunities", { p_player_id: context.userId, p_game_id: game.id });
    if (error || !data || typeof data !== "object") throw new Error("Opportunities unavailable");
    const result = data as { used?: unknown; reset_at?: unknown; exempt?: unknown };
    const used = Number(result.used);
    if (!Number.isSafeInteger(used) || used < 0 || typeof result.reset_at !== "string" || !Number.isFinite(Date.parse(result.reset_at))) throw new Error("Invalid opportunities");
    return NextResponse.json({ limit: 5, remaining: Math.max(0, 5 - used), exempt: result.exempt === true, resetAt: result.reset_at, extraAdsAvailable: false }, { headers });
  } catch {
    return NextResponse.json({ message: "Opportunities temporarily unavailable" }, { status: 503, headers });
  }
}
