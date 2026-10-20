import { NextResponse } from "next/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { isUuid, NO_STORE_HEADERS, readBoundedJson } from "@/lib/competition/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const auth = await getAuthorizedPrizeAdmin();
    if (!auth) return NextResponse.json({ message: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
    const body = await readBoundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "Invalid request" }, { status: 400, headers: NO_STORE_HEADERS });
    const b = body as Record<string, unknown>;
    if (Object.keys(b).length !== 2 || !isUuid(b.winnerId) || b.confirmedManualMatch !== true)
      return NextResponse.json({ message: "Owner comparison required" }, { status: 400, headers: NO_STORE_HEADERS });
    const { data, error } = await auth.admin.rpc("rtw_owner_verify_winner_email", { p_actor: auth.context.userId, p_winner: b.winnerId });
    if (error || data !== true) return NextResponse.json({ message: "Verification unavailable" }, { status: 409, headers: NO_STORE_HEADERS });
    return NextResponse.json({ verified: true }, { headers: NO_STORE_HEADERS });
  } catch { return NextResponse.json({ message: "Unavailable" }, { status: 503, headers: NO_STORE_HEADERS }); }
}
