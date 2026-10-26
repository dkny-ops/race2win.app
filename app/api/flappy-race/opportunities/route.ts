import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { flappyPlayerAccess } from "@/lib/game/flappy/server";
import { FLAPPY_COMPETITION_ENABLED } from "@/lib/game/flappy/activation";
import { parseFlappyAvailability } from "@/lib/game/flappy/availability";

export const runtime = "nodejs";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  const reject = (status: number, code: string) => NextResponse.json({ code }, { status, headers });
  try {
    const context = await getVerifiedUserContext();
    if (!context) return reject(401, "unauthenticated");
    if (!FLAPPY_COMPETITION_ENABLED) return reject(403, "FLAPPY_OFFICIAL_DISABLED");
    const access = await flappyPlayerAccess(context.userId);
    if (access !== "allowed") return reject(403, access);
    // Player identity comes exclusively from the verified session, never query parameters.
    const { data, error } = await createAdminClient().rpc("flappy_read_availability", { p_player: context.userId });
    if (error) throw new Error("Availability unavailable");
    return NextResponse.json(parseFlappyAvailability(data), { headers });
  } catch { return reject(503, "service_unavailable"); }
}
