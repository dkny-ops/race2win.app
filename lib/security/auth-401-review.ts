import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const REVIEW_MESSAGE = "Acceso pendiente de revisión. Contacta al administrador con tu referencia. El administrador dispone de hasta 48 horas desde que recibe tu solicitud para responder.";

export async function recordAuth401(route: string, reason: string, playerId: string | null = null) {
  const requestId = randomUUID();
  try {
    const { data, error } = await createAdminClient().rpc("rtw_record_auth_401", {
      p_request_id: requestId, p_route: route, p_reason: reason, p_player_id: playerId,
    });
    if (error || typeof data !== "string") throw new Error("Incident recording failed");
    return data as string;
  } catch {
    // Never claim a review was created if persistence failed.
    return null;
  }
}

export async function isGameAccessHeld(playerId: string) {
  const { data, error } = await createAdminClient().rpc("rtw_is_game_access_held", { p_player_id: playerId });
  if (error || typeof data !== "boolean") throw new Error("Unable to verify game access");
  return data;
}
