import { NextResponse } from "next/server";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isAdminConfigured()) return NextResponse.json({ message: "Unavailable" }, { status: 503, headers });
  try {
    const monday = new Date(currentNewYorkTournamentWeek() + "T12:00:00Z");
    monday.setUTCDate(monday.getUTCDate() - 7);
    const tournamentWeek = monday.toISOString().slice(0, 10);
    const { data, error } = await createAdminClient().rpc("flappy_read_ranking", { p_week: tournamentWeek, p_page: 1 });
    if (error || !data || !Array.isArray(data.entries)) throw new Error("Ranking unavailable");
    const entries = data.entries.filter((row: unknown) => {
      if (!row || typeof row !== "object") return false;
      const r = row as Record<string, unknown>;
      return Number.isInteger(r.rank) && Number(r.rank) >= 1 && Number(r.rank) <= 3 &&
        typeof r.username === "string" && r.username.length > 0 &&
        Number.isSafeInteger(r.weeklyTotal) && Number(r.weeklyTotal) >= 0 && r.reviewRequired === false;
    }).map((r: { rank: number; username: string; weeklyTotal: number }) => ({
      rank: r.rank, username: r.username, weeklyTotal: r.weeklyTotal,
    }));
    return NextResponse.json({ tournamentWeek, entries }, { headers });
  } catch {
    return NextResponse.json({ message: "Previous week unavailable" }, { status: 503, headers });
  }
}
