import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { NextResponse } from "next/server";
import { isUuid, NO_STORE_HEADERS } from "@/lib/competition/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authorization = await getAuthorizedPrizeAdmin();
    if (!authorization) return NextResponse.json({ message: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
    const { admin } = authorization;
    const url = new URL(request.url);
    const payoutId = url.searchParams.get("payoutId");
    if (!isUuid(payoutId)) return NextResponse.json({ message: "Invalid request" }, { status: 400, headers: NO_STORE_HEADERS });
    const { data: payout, error: payoutError } = await admin.from("payouts")
      .select("player_id,status").eq("id", payoutId).maybeSingle();
    if (payoutError || !payout || !["requested", "under_review"].includes(payout.status))
      return NextResponse.json({ message: "Payout unavailable" }, { status: 404, headers: NO_STORE_HEADERS });
    const { data: account, error } = await admin.auth.admin.getUserById(payout.player_id);
    if (error || !account.user?.email || !account.user.email_confirmed_at)
      return NextResponse.json({ message: "Verified email unavailable" }, { status: 404, headers: NO_STORE_HEADERS });
    return NextResponse.json({ email: account.user.email }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ message: "Recipient unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
