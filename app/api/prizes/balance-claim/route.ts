import { NextResponse } from "next/server";
import { NO_STORE_HEADERS } from "@/lib/competition/server";

// Retired endpoint: players may contact the owner, but cannot initiate
// financial balance holds or payout requests from the browser.
export async function POST() {
  return NextResponse.json({ message: "Balance claims are owner-managed." }, { status: 403, headers: NO_STORE_HEADERS });
}
