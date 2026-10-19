import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { isUuid, NO_STORE_HEADERS, readBoundedJson } from "@/lib/competition/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await getVerifiedUserContext();
    if (!context) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
    if (!isAdminConfigured()) return NextResponse.json({ message: "Unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
    const admin = createAdminClient();
    const { data: allowed, error: gateError } = await admin.rpc("rtw_server_is_active_admin", { p_actor_user_id: context.userId });
    if (gateError || allowed !== true) return NextResponse.json({ message: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
    const body = await readBoundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "Invalid request" }, { status: 400, headers: NO_STORE_HEADERS });
    const value = body as Record<string, unknown>;
    if (Object.keys(value).length !== 2 || !isUuid(value.payoutId) || value.confirmedManualMatch !== true)
      return NextResponse.json({ message: "Manual confirmation required" }, { status: 400, headers: NO_STORE_HEADERS });
    const { data, error } = await admin.rpc("rtw_admin_attest_payout_email", {
      p_actor_user_id: context.userId, p_payout_id: value.payoutId,
    });
    if (error || data !== true) return NextResponse.json({ message: "Challenge expired, used or unavailable" }, { status: 409, headers: NO_STORE_HEADERS });
    return NextResponse.json({ verified: true, note: "Owner attestation recorded; not an independent email authentication." }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ message: "Verification unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
