import { NextResponse } from "next/server";
import { parseFlappyPage, readFlappyRanking } from "@/lib/competition/flappy-ranking";
import { isAdminConfigured } from "@/lib/supabase/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const page = parseFlappyPage(new URL(request.url).searchParams);
  if (page === null) return NextResponse.json({ message: "Invalid leaderboard request." }, { status: 400, headers });
  if (!isAdminConfigured()) return NextResponse.json({ message: "FlappyRace ranking is temporarily unavailable." }, { status: 503, headers });
  try { return NextResponse.json(await readFlappyRanking(page), { headers }); }
  catch { return NextResponse.json({ message: "FlappyRace ranking is temporarily unavailable." }, { status: 503, headers }); }
}
// No browser score can be accepted until a server-authoritative validator exists.
// Duplicate/repeated submissions have no database or prize side effects.
export async function POST() {
  return NextResponse.json({ code: "FLAPPY_OFFICIAL_DISABLED",
    message: "Official FlappyRace score submissions are not enabled." }, { status: 403, headers });
}
