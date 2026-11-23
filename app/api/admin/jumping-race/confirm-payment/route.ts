import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/competition/request-body";
import { isUuid } from "@/lib/competition/server";
import { parseFlappyWeek } from "@/lib/game/flappy/tournament";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const reply = (status: number, message: string) => NextResponse.json({ message }, { status, headers });

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return reply(403, "Solicitud no autorizada.");
    const auth = await getAuthorizedPrizeAdmin();
    if (!auth) return reply(404, "No disponible.");
    const body = await readBoundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, "Solicitud inválida.");
    const input = body as Record<string, unknown>; const week = parseFlappyWeek(input.week);
    if (Object.keys(input).length !== 4 || !week || !isUuid(input.playerId) || !isUuid(input.winnerId) || input.confirmedPaidByOwner !== true) return reply(400, "Confirmación inválida.");
    const { data: game, error: gameError } = await auth.admin.from("games").select("id").eq("slug", "jumping-race").maybeSingle();
    if (gameError || !game) return reply(503, "Juego no disponible.");
    const { data: winner, error: winnerError } = await auth.admin.from("provisional_winners").select("id,status,allocation_status").eq("id", input.winnerId).eq("player_id", input.playerId).eq("game_id", game.id).eq("tournament_week_start", week).eq("award_type", "weekly_tournament").maybeSingle();
    if (winnerError || !winner || winner.status !== "approved_for_payment" || winner.allocation_status !== "allocated") return reply(409, "El premio no está acreditado o no pertenece a este ganador.");
    const { data: balance, error: balanceError } = await auth.admin.from("prize_balances").select("available_cents").eq("player_id", input.playerId).maybeSingle();
    if (balanceError || !balance || balance.available_cents < 2000) return reply(409, "El balance no alcanza el mínimo de $20.");
    const { data: paid, error } = await auth.admin.rpc("rtw_owner_confirm_full_balance_paid", { p_actor: auth.context.userId, p_player: input.playerId, p_winner: input.winnerId });
    if (error || typeof paid !== "number") return reply(409, "No se pudo registrar el pago. Verifica el balance y los retiros pendientes.");
    return NextResponse.json({ paidCents: paid, message: "Pago externo registrado. Balance disponible: $0.00." }, { headers });
  } catch { return reply(503, "No se pudo confirmar el pago."); }
}
