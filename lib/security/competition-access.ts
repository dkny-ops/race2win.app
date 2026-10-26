import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createAdminClient } from "@/lib/supabase/admin";

/** Only Vercel's overwritten client-IP header is trusted. Never use client XFF. */
export function networkEvidenceHmac(request: Request, now = new Date()): string | null {
  const key = process.env.RTW_ABUSE_HMAC_KEY;
  if (process.env.VERCEL !== "1" || !key || Buffer.byteLength(key) < 32) return null;
  const ip = request.headers.get("x-vercel-forwarded-for")?.trim();
  if (!ip || !isIP(ip)) return null;
  // Canonicalize IPv6 spellings without retaining an address or prefix.
  const normalized = isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname : ip;
  return createHmac("sha256", key).update(`rtw:network:v1:${now.toISOString().slice(0, 10)}:${normalized}`).digest("hex");
}

export type CompetitionAccess = "allowed" | "verified_email_required" | "identity_conflict" | "unavailable";
export async function recordCompetitionAccess(player: string, game: "race-to-win" | "flappy-race", request: Request): Promise<CompetitionAccess> {
  try {
    const { data, error } = await createAdminClient().rpc("rtw_record_competition_access", {
      p_player: player, p_game: game, p_network_hmac: networkEvidenceHmac(request),
    });
    return !error && ["allowed", "verified_email_required", "identity_conflict"].includes(data) ? data : "unavailable";
  } catch { return "unavailable"; }
}
export function competitionAccessMessage(status: CompetitionAccess): string {
  if (status === "verified_email_required") return "Verifica tu correo antes de iniciar una partida oficial.";
  if (status === "identity_conflict") return "Esta identidad competitiva ya está asociada a otra cuenta. Contacta con administración para revisarla.";
  return "La verificación de acceso no está disponible. Inténtalo de nuevo.";
}
