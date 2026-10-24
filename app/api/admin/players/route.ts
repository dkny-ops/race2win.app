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
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let profilesQuery = admin.from("profiles").select("user_id,username,created_at").order("created_at", { ascending: false }).limit(50);
  if (query) profilesQuery = uuid.test(query) ? profilesQuery.eq("user_id", query) : profilesQuery.ilike("username", "%" + query.replace(/[%_\\]/g, "") + "%");
  const { data: profiles, error } = await profilesQuery;
  if (error) return NextResponse.json({ message: "No se pudo consultar jugadores" }, { status: 503, headers });
  const ids = (profiles ?? []).map(p => p.user_id);
  if (!ids.length) return NextResponse.json({ players: [] }, { headers });
  const [sessions, runs, totals, balances, flags] = await Promise.all([
    admin.from("game_sessions").select("id,user_id,status,started_at,final_score,final_elapsed_ms,final_distance_millimeters").in("user_id", ids).order("started_at", { ascending: false }).limit(250),
    admin.from("validated_runs").select("player_id,score,elapsed_ms,distance_millimeters,completed_at,eligibility_status").in("player_id", ids).order("completed_at", { ascending: false }).limit(250),
    admin.from("weekly_tournament_totals").select("player_id,tournament_week_start,weekly_total_score,rank_position").in("player_id", ids).order("tournament_week_start", { ascending: false }).limit(150),
    admin.from("prize_balances").select("player_id,available_cents").in("player_id", ids),
    admin.from("fraud_flags").select("player_id,severity,status,signal_summary,created_at").in("player_id", ids).order("created_at", { ascending: false }).limit(100),
  ]);
  if ([sessions,runs,totals,balances,flags].some(r => r.error)) return NextResponse.json({ message: "No se pudo cargar la actividad" }, { status: 503, headers });
  const players = await Promise.all((profiles ?? []).map(async p => {
    const identity = await admin.auth.admin.getUserById(p.user_id);
    const email = !identity.error && identity.data.user?.email_confirmed_at ? identity.data.user.email ?? null : null;
    return {
      id: p.user_id, username: p.username, createdAt: p.created_at, email,
      sessions: (sessions.data ?? []).filter(x => x.user_id === p.user_id).slice(0, 10),
      runs: (runs.data ?? []).filter(x => x.player_id === p.user_id).slice(0, 10),
      weekly: (totals.data ?? []).filter(x => x.player_id === p.user_id).slice(0, 5),
      balanceCents: (balances.data ?? []).find(x => x.player_id === p.user_id)?.available_cents ?? 0,
      flags: (flags.data ?? []).filter(x => x.player_id === p.user_id).slice(0, 5),
    };
  }));
  return NextResponse.json({ players }, { headers });
}
