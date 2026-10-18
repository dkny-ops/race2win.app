import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";
import { RACE_TO_WIN_GAME_SLUG } from "@/lib/routes";

export const runtime = "nodejs";
export async function GET() {
  try {
    const currentWeek = currentNewYorkTournamentWeek();
    const monday = new Date(currentWeek + "T12:00:00Z");
    monday.setUTCDate(monday.getUTCDate() - 7);
    const previousWeek = monday.toISOString().slice(0, 10);
    const admin = createAdminClient();
    const { data: game, error: gameError } = await admin.from("games").select("id").eq("slug", RACE_TO_WIN_GAME_SLUG).eq("status", "active").single();
    if (gameError || !game) throw new Error("Game unavailable");
    const { data, error } = await admin.rpc("rtw_read_last_week_prizes", { p_game_id: game.id, p_week: previousWeek });
    if (error || !Array.isArray(data)) throw new Error("Winners unavailable");
    return NextResponse.json({ tournamentWeek: previousWeek, entries: data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ message: "Previous week prizes unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
