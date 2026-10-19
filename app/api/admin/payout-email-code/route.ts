import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { createHmac, randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { isUuid, NO_STORE_HEADERS, readBoundedJson } from "@/lib/competition/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authorization = await getAuthorizedPrizeAdmin();
    if (!authorization) return NextResponse.json({ message: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
    const { context, admin } = authorization;
    const body = await readBoundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !isUuid((body as Record<string, unknown>).payoutId))
      return NextResponse.json({ message: "Invalid request" }, { status: 400, headers: NO_STORE_HEADERS });
    const payoutId = (body as { payoutId: string }).payoutId;
    const { data: payout, error: payoutError } = await admin.from("payouts")
      .select("player_id,status").eq("id", payoutId).maybeSingle();
    if (payoutError || !payout || !["requested", "under_review"].includes(payout.status))
      return NextResponse.json({ message: "Payout unavailable" }, { status: 409, headers: NO_STORE_HEADERS });
    const { data: account, error: accountError } = await admin.auth.admin.getUserById(payout.player_id);
    if (accountError || !account.user?.email || !account.user.email_confirmed_at)
      return NextResponse.json({ message: "Confirmed registered email required" }, { status: 409, headers: NO_STORE_HEADERS });
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const digest = createHmac("sha256", process.env.PAYOUT_EMAIL_CODE_SECRET)
      .update(payoutId + ":" + code).digest("hex");
    const { data: expiresAt, error } = await admin.rpc("rtw_admin_issue_payout_challenge", {
      p_actor_user_id: context.userId, p_payout_id: payoutId, p_digest: digest,
    });
    if (error || typeof expiresAt !== "string")
      return NextResponse.json({ message: "Challenge unavailable or already active" }, { status: 409, headers: NO_STORE_HEADERS });
    return NextResponse.json({ code, expiresAt, payoutId }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ message: "Verification unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
