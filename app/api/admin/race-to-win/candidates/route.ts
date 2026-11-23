import { NextResponse } from "next/server";
import { readBoundedJson, isUuid } from "@/lib/competition/server";
import { parseFlappyWeek } from "@/lib/game/flappy/tournament";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({}, { status: 403, headers });
    const auth = await getAuthorizedPrizeAdmin();
    if (!auth) return NextResponse.json({}, { status: 404, headers });
    const b = await readBoundedJson(request) as Record<string, unknown> | null;
    if (!b || Object.keys(b).length !== 2 || !isUuid(b.playerId) || !parseFlappyWeek(b.week)) return NextResponse.json({}, { status: 400, headers });
    const { error } = await auth.admin.rpc("rtw_admin_reject_winner_candidate", { p_actor: auth.context.userId, p_player: b.playerId, p_week: b.week, p_note: "Owner rejected the candidate after manual review." });
    return NextResponse.json({ message: error ? "Rechazo no disponible. Revisa el estado del expediente." : "Rechazo registrado. Se presenta el siguiente candidato elegible." }, { status: error ? 409 : 200, headers });
  } catch { return NextResponse.json({}, { status: 503, headers }); }
}
