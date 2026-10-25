import { handleFlappy } from "@/lib/game/flappy/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleFlappy("start", request); }
