import { NextResponse } from "next/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { isUuid, NO_STORE_HEADERS, readBoundedJson } from "@/lib/competition/server";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const auth = await getAuthorizedPrizeAdmin();
    if (!auth) return NextResponse.json({ message: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
    const body = await readBoundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "Invalid request" }, { status: 400, headers: NO_STORE_HEADERS });
    const b = body as Record<string, unknown>;
    if (Object.keys(b).length !== 2 || !isUuid(b.playerId) || b.confirmedPaidByOwner !== true)
      return NextResponse.json({ message: "Owner confirmation required" }, { status: 400, headers: NO_STORE_HEADERS });

    const monday = new Date(currentNewYorkTournamentWeek() + "T12:00:00Z");
    monday.setUTCDate(monday.getUTCDate() - 7);
    const week = monday.toISOString().slice(0, 10);
    const { data: game, error: gameError } = await auth.admin.from("games").select("id").eq("slug", "race-to-win").single();
    if (gameError || !game) throw new Error("Game unavailable");
    const { data: rank, error: rankError } = await auth.admin.from("weekly_tournament_totals")
      .select("rank_position,tie_break_status").eq("game_id", game.id).eq("tournament_week_start", week)
      .eq("player_id", b.playerId).gte("rank_position", 1).lte("rank_position", 3).maybeSingle();
    if (rankError || !rank || rank.tie_break_status !== "resolved") return NextResponse.json({ message: "Winner not finalized" }, { status: 409, headers: NO_STORE_HEADERS });

    let { data: award, error: awardError } = await auth.admin.from("provisional_winners")
      .select("id,status,paid_at,allocation_status").eq("game_id", game.id).eq("tournament_week_start", week)
      .eq("player_id", b.playerId).eq("award_type", "weekly_tournament").maybeSingle();
    if (awardError) throw awardError;
    if (!award) {
      const deadline = new Date(week + "T12:00:00Z");
      deadline.setUTCDate(deadline.getUTCDate() + 8);
      const amount = rank.rank_position === 1 ? 1500 : rank.rank_position === 2 ? 300 : 200;
      const created = await auth.admin.from("provisional_winners").upsert({
        game_id: game.id, player_id: b.playerId, tournament_week_start: week,
        award_type: "weekly_tournament", rank_position: rank.rank_position, amount_cents: amount,
        allocation_status: "allocated", status: "provisional", claim_deadline_at: deadline.toISOString(),
      }, { onConflict: "game_id,tournament_week_start,award_type,player_id,allocation_revision", ignoreDuplicates: true })
        .select("id,status,paid_at,allocation_status").maybeSingle();
      if (created.error) throw created.error;
      award = created.data;
      if (!award) {
        const fetched = await auth.admin.from("provisional_winners").select("id,status,paid_at,allocation_status")
          .eq("game_id", game.id).eq("tournament_week_start", week).eq("player_id", b.playerId)
          .eq("award_type", "weekly_tournament").maybeSingle();
        if (fetched.error) throw fetched.error;
        award = fetched.data;
      }
    }
    if (!award || award.allocation_status !== "allocated" || ["disqualified", "expired"].includes(award.status))
      return NextResponse.json({ message: "Award not payable" }, { status: 409, headers: NO_STORE_HEADERS });
    const { data, error } = await auth.admin.rpc("rtw_owner_close_winner_contact", { p_actor: auth.context.userId, p_winner: award.id });
    if (error || data !== true) return NextResponse.json({ message: "Could not record payment confirmation" }, { status: 409, headers: NO_STORE_HEADERS });
    return NextResponse.json({ closed: true, note: "Owner payment confirmation recorded. No money transferred." }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ message: "Unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
