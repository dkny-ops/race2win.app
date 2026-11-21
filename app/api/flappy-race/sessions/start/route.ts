import { NextResponse } from "next/server";
import { getTurnstileWidgetConfiguration } from "@/lib/security/turnstile";
import { handleFlappy } from "@/lib/game/flappy/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleFlappy("start", request); }

export async function GET() { const config = getTurnstileWidgetConfiguration("midrun_human_check"); return NextResponse.json(config ?? { unavailable: true }, { status: config ? 200 : 503, headers: { "Cache-Control": "no-store" } }); }
