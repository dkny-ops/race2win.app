import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { RACE_TO_WIN_GAME_SLUG } from "@/lib/routes";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const runtime = "nodejs";
const CACHE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const context = await getVerifiedUserContext();
    if (!context) return NextResponse.json({ message: "Sign in to view official plays." }, { status: 401, headers: CACHE });
    if (!isAdminConfigured()) return NextResponse.json({ message: "Official plays are unavailable." }, { status: 503, headers: CACHE });
    const { data, error } = await createAdminClient().rpc("rtw_read_official_play_allowance", { p_player_id: context.userId, p_game_slug: RACE_TO_WIN_GAME_SLUG });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row || !Number.isSafeInteger(Number(row.free_plays_remaining)) || !Number.isSafeInteger(Number(row.rewarded_plays_remaining)) || typeof row.hour_ends_at !== "string") throw new Error("invalid_allowance_response");
    return NextResponse.json({ freePlaysRemaining: Number(row.free_plays_remaining), rewardedPlaysRemaining: Number(row.rewarded_plays_remaining), hourEndsAt: row.hour_ends_at, rewardedAdsAvailable: false }, { headers: CACHE });
  } catch {
    return NextResponse.json({ message: "Official plays are unavailable." }, { status: 503, headers: CACHE });
  }
}
