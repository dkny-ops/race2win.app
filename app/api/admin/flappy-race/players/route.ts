import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedPrizeAdmin();
  if (!auth) return NextResponse.json({ message: "Not found" }, { status: 404, headers });
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length > 80) return NextResponse.json({ message: "Búsqueda demasiado larga" }, { status: 400, headers });
  const admin = auth.admin;
  const { data: game, error: gameError } = await admin.from("games").select("id").eq("slug","flappy-race").maybeSingle();
  if (gameError || !game) return NextResponse.json({message:"Flappy Race no disponible"},{status:503,headers});
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let profilesQuery = admin.from("profiles").select("user_id,username,created_at").order("created_at", { ascending: false }).limit(50);
  if (query) profilesQuery = uuid.test(query) ? profilesQuery.eq("user_id", query) : profilesQuery.ilike("username", "%" + query.replace(/[%_\\]/g, "") + "%");
  const { data: profiles, error } = await profilesQuery;
  if (error) { console.error("Admin player lookup profiles query failed:", error.code); return NextResponse.json({ message: "No se pudo consultar jugadores" }, { status: 503, headers }); }
  const ids = (profiles ?? []).map(p => p.user_id);
  if (!ids.length) return NextResponse.json({ players: [] }, { headers });
  // Flappy gameplay is stored in private.flappy_sessions / private.flappy_runs,
  // not in the shared Race To Win game_sessions / validated_runs tables.
  // Access only through the owner-gated, bounded Flappy admin RPC.
  type FlappyRow = { session_id:string; player_id:string; status:string; created_at:string; score:number|null; completed_at:string|null; verification:string|null; eligibility:string|null; tick:number|null };
  const flappyRows: FlappyRow[] = [];
  for (let page = 1; page <= 100; page++) {
    const { data, error: activityError } = await admin.rpc("flappy_admin_read", {
      p_actor: auth.context.userId, p_page: page,
    });
    if (activityError || !Array.isArray(data)) {
      console.error("Flappy admin activity read failed:", activityError?.code ?? "invalid_data");
      return NextResponse.json({message:"No se pudieron consultar las partidas de Flappy Race"},{status:503,headers});
    }
    flappyRows.push(...(data as FlappyRow[]).filter(row => ids.includes(row.player_id)));
    if (data.length < 50) break;
  }
  const [totals, flags] = await Promise.all([
    admin.from("weekly_tournament_totals").select("player_id,tournament_week_start,weekly_total_score,rank_position").eq("game_id",game.id).in("player_id",ids).order("tournament_week_start",{ascending:false}).limit(150),
    admin.from("fraud_flags").select("player_id,severity,status,signal_summary,created_at").eq("game_id",game.id).in("player_id",ids).order("created_at",{ascending:false}).limit(100),
  ]);
  if (totals.error || flags.error) console.error("Flappy admin optional summary read failed");
  const players = await Promise.all((profiles ?? []).map(async p => {
    const identity = await admin.auth.admin.getUserById(p.user_id);
    const email = !identity.error && identity.data.user?.email_confirmed_at ? identity.data.user.email ?? null : null;
    return {
      id: p.user_id, username: p.username, createdAt: p.created_at, email,
      sessions: flappyRows.filter(x => x.player_id === p.user_id).slice(0,10).map(x => ({id:x.session_id,status:x.status,started_at:x.created_at,final_score:x.score,final_elapsed_ms:x.tick == null ? null : Math.round(x.tick*1000/60),final_distance_millimeters:null})),
      runs: flappyRows.filter(x => x.player_id === p.user_id && x.completed_at && x.score != null).slice(0,10).map(x => ({score:x.score!,completed_at:x.completed_at!,eligibility_status:x.eligibility ?? x.verification ?? "No registrado"})),
      weekly: (totals.data ?? []).filter(x => x.player_id === p.user_id).slice(0, 5),
      balanceCents: 0,
      flags: (flags.data ?? []).filter(x => x.player_id === p.user_id).slice(0, 5),
    };
  }));
  return NextResponse.json({ players }, { headers });
}
