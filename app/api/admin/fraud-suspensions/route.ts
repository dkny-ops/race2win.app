import { NextResponse } from "next/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
 const auth = await getAuthorizedPrizeAdmin();
 if (!auth) return NextResponse.json({ message: "Not found" }, { status: 404, headers: HEADERS });
 const { data, error } = await auth.admin.from("rtw_player_suspensions")
  .select("player_id,fraud_flag_id,decided_by,reason,suspended_at,lifted_at")
  .order("suspended_at", { ascending: false }).limit(100);
 if (error) return NextResponse.json({ message: "Suspension review unavailable" }, { status: 503, headers: HEADERS });
 return NextResponse.json({ suspensions: data ?? [] }, { headers: HEADERS });
}

// Deliberately no POST: production account suspensions require separate
// explicit activation after testing and a confirmed, documented fraud review.
