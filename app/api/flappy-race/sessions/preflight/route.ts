import { handleFlappyPreflight } from "@/lib/game/flappy/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issues only a short-lived server nonce; it never starts a race or consumes an attempt. */
export async function POST(request: Request) {
  return handleFlappyPreflight(request);
}
