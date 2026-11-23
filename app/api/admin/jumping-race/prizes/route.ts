import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/competition/request-body";
import { isUuid } from "@/lib/competition/server";
import { parseFlappyWeek } from "@/lib/game/flappy/tournament";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const reply = (status: number, message: string) => NextResponse.json({ message }, { status, headers });

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return reply(403, "Solicitud no disponible.");
    const auth = await getAuthorizedPrizeAdmin();
    if (!auth) return reply(404, "No disponible.");
    const body = await readBoundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, "Solicitud inválida.");
    const input = body as Record<string, unknown>;
    if (input.action === "activate") {
      if (Object.keys(input).length !== 2 || input.confirmed !== true) return reply(400, "Confirma la activación.");
      const { error } = await auth.admin.rpc("jr_activate_prize_program", { p_actor: auth.context.userId });
      return error ? reply(409, "El programa no pudo activarse.") : reply(200, "Programa activado desde la semana actual. No se crearon premios ni pagos.");
    }
    const week = parseFlappyWeek(input.week);
    if (Object.keys(input).length !== 4 || input.action !== "allocate" || !week || !isUuid(input.playerId) || typeof input.note !== "string" || input.note.trim().length < 1 || input.note.length > 500) return reply(400, "Solicitud inválida.");
    const { error } = await auth.admin.rpc("jr_admin_allocate_prize", { p_actor: auth.context.userId, p_week: week, p_player: input.playerId, p_note: input.note.trim() });
    return error ? reply(409, "El crédito de premio no está disponible.") : reply(200, "Crédito aprobado. No se ejecutó ningún pago.");
  } catch { return reply(503, "Revisión de premios temporalmente no disponible."); }
}
