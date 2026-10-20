import { NextResponse } from "next/server";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";
import { getVerifiedPlayerId, getWhatsAppClaimUrl, NO_STORE_HEADERS } from "@/lib/competition/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const playerId = await getVerifiedPlayerId();
    if (!playerId) return NextResponse.json({ eligible: false }, { status: 401, headers: NO_STORE_HEADERS });
    const whatsappUrl = getWhatsAppClaimUrl();
    if (!isAdminConfigured() || !whatsappUrl) return NextResponse.json({ eligible: false }, { headers: NO_STORE_HEADERS });
    const currentWeek = currentNewYorkTournamentWeek();
    const monday = new Date(currentWeek + "T12:00:00Z");
    monday.setUTCDate(monday.getUTCDate() - 7);
    const finishedWeek = monday.toISOString().slice(0, 10);
    const admin = createAdminClient();
    const { data: game, error: gameError } = await admin.from("games").select("id").eq("slug", "race-to-win").maybeSingle();
    if (gameError || !game) throw new Error("Game unavailable");
    const { data: winner, error } = await admin.from("weekly_tournament_totals")
      .select("rank_position,tie_break_status").eq("game_id", game.id)
      .eq("tournament_week_start", finishedWeek).eq("player_id", playerId)
      .gte("rank_position", 1).lte("rank_position", 3).maybeSingle();
    if (error) throw error;
    const { data: award, error: awardError } = await admin.from("provisional_winners")
      .select("id,status,paid_at,amount_cents,allocation_status").eq("game_id", game.id)
      .eq("tournament_week_start", finishedWeek).eq("player_id", playerId)
      .eq("award_type", "weekly_tournament").maybeSingle();
    if (awardError) throw awardError;
    const { data: contactClosed, error: closureError } = award ? await admin.rpc("rtw_is_winner_contact_closed", { p_winner: award.id }) : { data: false, error: null };
    if (closureError) throw closureError;
    const alreadyPaid = Boolean(award && (award.status === "paid" || award.paid_at !== null || contactClosed === true));
    const eligible = Boolean(winner && award && winner.tie_break_status !== "tie_pending_review" && !alreadyPaid);
    const prizeCents = eligible ? (typeof award?.amount_cents === "number" && award.amount_cents > 0 ? award.amount_cents : winner?.rank_position === 1 ? 1500 : winner?.rank_position === 2 ? 300 : winner?.rank_position === 3 ? 200 : 0) : 0;
    return NextResponse.json({ eligible, prizeCents, whatsappUrl: eligible ? whatsappUrl : null }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ eligible: false }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
