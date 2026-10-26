import { NextResponse } from "next/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { isUuid, NO_STORE_HEADERS, readBoundedJson } from "@/lib/competition/server";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({message:"Unavailable"},{status:403,headers:NO_STORE_HEADERS});
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
    const {data:candidates,error:rankError} = await auth.admin.rpc("rtw_admin_read_winner_candidates", {p_actor:auth.context.userId,p_week:week});
    const rank = Array.isArray(candidates) ? candidates.find((candidate: {player_id:string}) => candidate.player_id === b.playerId) : null;
    if (rankError || !rank || rank.tie_break_status !== "resolved") return NextResponse.json({message:"Ranking not finalized"},{status:409,headers:NO_STORE_HEADERS});
    let {data:award,error:awardError} = await auth.admin.from("provisional_winners").select("id,status,allocation_status,amount_cents").eq("game_id",game.id).eq("tournament_week_start",week).eq("player_id",b.playerId).eq("award_type","weekly_tournament").maybeSingle();
    if (awardError) throw awardError;
    if (!award) {
      const deadline = new Date(week + "T12:00:00Z");
      deadline.setUTCDate(deadline.getUTCDate() + 8);
      const expectedAmount = rank.rank_position === 1 ? 1500 : rank.rank_position === 2 ? 300 : 200;
      const inserted = await auth.admin.from("provisional_winners").insert({
        game_id: game.id, player_id: b.playerId, tournament_week_start: week,
        award_type: "weekly_tournament", rank_position: rank.rank_position,
        amount_cents: expectedAmount, allocation_status: "allocated",
        status: "provisional", claim_deadline_at: deadline.toISOString(),
      });
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
      const found = await auth.admin.from("provisional_winners")
        .select("id,status,allocation_status,amount_cents")
        .eq("game_id",game.id).eq("tournament_week_start",week)
        .eq("player_id",b.playerId).eq("award_type","weekly_tournament").maybeSingle();
      if (found.error) throw found.error;
      award = found.data;
    }
    const expected = rank.rank_position === 1 ? 1500 : rank.rank_position === 2 ? 300 : 200;
    if (!award || award.allocation_status !== "allocated" || award.amount_cents !== expected || ["disqualified","expired","paid"].includes(award.status)) return NextResponse.json({message:"Prize cannot be validated"},{status:409,headers:NO_STORE_HEADERS});
    const transitions: Record<string,string[]> = {
      provisional: ["under_review","verified","approved_for_payment"],
      claim_started: ["under_review","verified","approved_for_payment"],
      under_review: ["verified","approved_for_payment"],
      verified: ["approved_for_payment"],
      approved_for_payment: [],
    };
    const steps = transitions[award.status];
    if (!steps) return NextResponse.json({message:"Prize state not eligible for validation"},{status:409,headers:NO_STORE_HEADERS});
    for (const status of steps) {
      const result = await auth.admin.rpc("rtw_admin_transition_winner",{
        p_actor_user_id:auth.context.userId,p_winner_id:award.id,
        p_new_status:status,p_note:"Owner reviewed games and validated wallet balance",
      });
      if (result.error) throw result.error;
    }
    return NextResponse.json({validated:true,amountCents:expected},{headers:NO_STORE_HEADERS});
  } catch { return NextResponse.json({message:"Balance validation unavailable"},{status:503,headers:NO_STORE_HEADERS}); }
}
