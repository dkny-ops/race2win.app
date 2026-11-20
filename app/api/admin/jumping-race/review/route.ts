import { NextResponse } from "next/server";
import { isUuid, readBoundedJson } from "@/lib/competition/server";
import { parseFlappyWeek } from "@/lib/game/flappy/tournament";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const decisions = new Set(["approved", "rejected", "needs_additional_review"]);

function response(status: number, message: string) {
  return NextResponse.json({ message }, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin ||
        request.headers.get("sec-fetch-site") === "cross-site") {
      return response(403, "Solicitud no disponible.");
    }
    const auth = await getAuthorizedPrizeAdmin();
    if (!auth) return response(404, "No disponible.");

    const body = await readBoundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return response(400, "Solicitud inválida.");
    const input = body as Record<string, unknown>;
    const week = parseFlappyWeek(input.week);
    if (!week || input.confirmed !== true) return response(400, "Confirma la revisión.");
    const args = { p_actor: auth.context.userId, p_week: week };

    if (input.action === "close" && Object.keys(input).length === 3) {
      const { error } = await auth.admin.rpc("jr_close_prize_period", args);
      return error ? response(409, "La semana no está disponible para cierre.") : response(200, "Cierre procesado.");
    }

    if (Object.keys(input).length !== 5 || typeof input.action !== "string" ||
        !decisions.has(input.action) || !isUuid(input.playerId) ||
        typeof input.note !== "string" || !input.note.trim() || input.note.length > 500) {
      return response(400, "Solicitud inválida.");
    }
    const { error } = await auth.admin.rpc("jr_decide_prize_candidate", {
      ...args, p_player: input.playerId, p_decision: input.action, p_note: input.note.trim(),
    });
    return error ? response(409, "El expediente no está disponible para esta decisión.") : response(200, "Decisión registrada.");
  } catch {
    return response(503, "Revisión temporalmente no disponible.");
  }
}
