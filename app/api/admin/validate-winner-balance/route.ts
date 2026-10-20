import { NextResponse } from "next/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { isUuid, NO_STORE_HEADERS, readBoundedJson } from "@/lib/competition/server";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const auth = await getAuthorizedPrizeAdmin();
    if (!auth) return NextResponse.json({message:"Not found"},{status:404,headers:NO_STORE_HEADERS});
    const body = await readBoundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({message:"Invalid request"},{status:400,headers:NO_STORE_HEADERS});
    const b = body as Record<string,unknown>;
    if (Object.keys(b).length !== 2 || !isUuid(b.playerId) || b.confirmedReviewed !== true) return NextResponse.json({message:"Review confirmation required"},{status:400,headers:NO_STORE_HEADERS});
    const monday = new Date(currentNewYorkTournamentWeek()+"T12:00:00Z");
    monday.setUTCDate(monday.getUTCDate()-7);
    const week = monday.toISOString().slice(0,10);
    const {data:game,error:gameError} = await auth.admin.from("games").select("id").eq("slug","race-to-win").single();
    if (gameError || !game) throw new Error("Game unavailable");
    const {data:rank,error:rankError} = await auth.admin.from("weekly_tournament_totals").select("rank_position,tie_break_status").eq("game_id",game.id).eq("tournament_week_start",week).eq("player_id",b.playerId).gte("rank_position",1).lte("rank_position",3).maybeSingle();
    if (rankError || !rank || rank.tie_break_status !== "resolved") return NextResponse.json({message:"Ranking not finalized"},{status:409,headers:NO_STORE_HEADERS});
    let {data:award,error:awardError} = await auth.admin.from("provisional_winners").select("id,status,allocation_status,amount_cents").eq("game_id",game.id).eq("tournament_week_start",week).eq("player_id",b.playerId).eq("award_type","weekly_tournament").maybeSingle();
    if (awardError) throw awardError;
    if (!award) {
      const generated = await auth.admin.rpc("rtw_generate_provisional_winners",{p_actor_user_id:auth.context.userId,p_game_slug:"race-to-win",p_week_start:week});
      if (generated.error) throw generated.error;
      const found = await auth.admin.from("provisional_winners").select("id,status,allocation_status,amount_cents").eq("game_id",game.id).eq("tournament_week_start",week).eq("player_id",b.playerId).eq("award_type","weekly_tournament").maybeSingle();
      if (found.error) throw found.error;
      award = found.data;
    }
    const expected = rank.rank_position === 1 ? 1500 : rank.rank_position === 2 ? 300 : 200;
    if (!award || award.allocation_status !== "allocated" || award.amount_cents !== expected || ["disqualified","expired","paid"].includes(award.status)) return NextResponse.json({message:"Prize cannot be validated"},{status:409,headers:NO_STORE_HEADERS});
    if (award.status !== "approved_for_payment") {
      const result = await auth.admin.rpc("rtw_admin_transition_winner",{p_actor_user_id:auth.context.userId,p_winner_id:award.id,p_new_status:"approved_for_payment",p_note:"Owner reviewed games and validated wallet balance"});
      if (result.error) throw result.error;
    }
    return NextResponse.json({validated:true,amountCents:expected},{headers:NO_STORE_HEADERS});
  } catch { return NextResponse.json({message:"Balance validation unavailable"},{status:503,headers:NO_STORE_HEADERS}); }
}
