import { NextResponse } from "next/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  const auth = await getAuthorizedPrizeAdmin();
  if (!auth) return NextResponse.json({ message: "Not found" }, { status: 404, headers });
  const { data, error } = await auth.admin.rpc("rtw_list_auth_401_reviews", { p_actor_user_id: auth.context.userId });
  if (error) return NextResponse.json({ message: "Review unavailable" }, { status: 503, headers });
  return NextResponse.json({ incidents: data ?? [] }, { headers });
}
export async function POST(request: Request) {
  const auth = await getAuthorizedPrizeAdmin();
  if (!auth) return NextResponse.json({ message: "Not found" }, { status: 404, headers });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ message: "Invalid request" }, { status: 400, headers }); }
  const playerId = typeof body === "object" && body !== null && "playerId" in body ? (body as {playerId: unknown}).playerId : null;
  if (typeof playerId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playerId)) {
    return NextResponse.json({ message: "Invalid player ID" }, { status: 400, headers });
  }
  const { data, error } = await auth.admin.rpc("rtw_authorize_game_access", { p_actor_user_id: auth.context.userId, p_player_id: playerId });
  if (error) return NextResponse.json({ message: "Authorization unavailable" }, { status: 503, headers });
  return NextResponse.json({ authorized: data === true }, { headers });
}
