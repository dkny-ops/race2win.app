import { NextResponse } from "next/server";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  const context = await getVerifiedUserContext();
  if (!context) return NextResponse.json({ message: "Sign in required." }, { status: 401, headers: HEADERS });
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("accepted" in body) || (body as { accepted: unknown }).accepted !== true) {
      return NextResponse.json({ message: "Explicit acceptance required." }, { status: 400, headers: HEADERS });
    }
    const { error } = await createAdminClient().rpc("rtw_accept_current_terms", { p_player_id: context.userId, p_version: "2026-10-26" });
    if (error) throw error;
    return NextResponse.json({ accepted: true }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ message: "Unable to save acceptance." }, { status: 503, headers: HEADERS });
  }
}
