import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}
