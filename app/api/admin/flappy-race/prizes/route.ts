import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/competition/request-body";
import { parseFlappyWeek } from "@/lib/game/flappy/tournament";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}$/i;
const decisions = new Set(["approved", "rejected", "needs_additional_review"]);

function response(status: number, message: string) {
  return NextResponse.json({ message }, { status, headers });
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
      return response(403, "Request unavailable.");
    }
    const authorization = await getAuthorizedPrizeAdmin();
    if (!authorization) return response(404, "Unavailable.");

    const body = await readBoundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return response(400, "Invalid request.");
    const input = body as Record<string, unknown>;
    const week = parseFlappyWeek(input.week);
    if (
      Object.keys(input).length !== 4 ||
      !week ||
      typeof input.playerId !== "string" || !uuid.test(input.playerId) ||
      typeof input.action !== "string" ||
      typeof input.note !== "string" || input.note.trim().length < 1 || input.note.length > 500
    ) return response(400, "Invalid request.");

    if (input.action === "allocate") {
      const { error } = await authorization.admin.rpc("flappy_admin_allocate_prize", {
        p_actor: authorization.context.userId, p_week: week, p_player: input.playerId, p_note: input.note.trim(),
      });
      return error
        ? response(409, "Prize allocation unavailable.")
        : response(200, "Prize credit approved. No payment was executed.");
    }

    if (!decisions.has(input.action)) return response(400, "Invalid request.");
    const { error } = await authorization.admin.rpc("flappy_decide_prize_candidate", {
      p_actor: authorization.context.userId, p_week: week, p_player: input.playerId,
      p_decision: input.action, p_note: input.note.trim(),
    });
    return error
      ? response(409, "Candidate decision unavailable.")
      : response(200, "Prize-candidate decision recorded. No credit or payment was created.");
  } catch {
    return response(503, "Prize review temporarily unavailable.");
  }
}
