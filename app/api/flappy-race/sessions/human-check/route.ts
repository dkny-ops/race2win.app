import { handleFlappyHumanCheck } from "@/lib/game/flappy/human-check-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleFlappyHumanCheck(request); }
