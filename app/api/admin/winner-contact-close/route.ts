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
    if (!award || award.status !== "approved_for_payment" || award.allocation_status !== "allocated")
      return NextResponse.json({message:"Validate balance before confirming full payment"},{status:409,headers:NO_STORE_HEADERS});
    const { data: balance, error: balanceError } = await auth.admin.from("prize_balances")
      .select("available_cents").eq("player_id", b.playerId).maybeSingle();
    if (balanceError) throw balanceError;
    if (!balance || balance.available_cents < 1000)
      return NextResponse.json({ message: "Payment unavailable: minimum $10 balance not reached." }, { status: 409, headers: NO_STORE_HEADERS });
    const {data:paidCents,error:paymentError} = await auth.admin.rpc("rtw_owner_confirm_full_balance_paid",{
      p_actor:auth.context.userId,p_player:b.playerId,p_winner:award.id,
    });
    if (paymentError || typeof paidCents !== "number")
      return NextResponse.json({message:"Full balance payment confirmation rejected; check available balance and pending payout requests"},{status:409,headers:NO_STORE_HEADERS});
    return NextResponse.json({closed:true,paidCents,note:"Full available balance recorded as paid externally"},{headers:NO_STORE_HEADERS});
  } catch {
    return NextResponse.json({ message: "Unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
