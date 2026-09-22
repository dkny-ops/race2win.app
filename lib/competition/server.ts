import "server-only";

import {
  COMPETITION_MUTATION_BODY_LIMIT_BYTES,
  hasEmptyBoundedBody,
  readBoundedJson,
} from "@/lib/competition/request-body";
import { RACE_TO_WIN_GAME_SLUG } from "@/lib/routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export { COMPETITION_MUTATION_BODY_LIMIT_BYTES, hasEmptyBoundedBody, readBoundedJson };

export type CompetitionRateLimitAction = "referral_attach" | "prize_claim" | "balance_claim" | "game_checkpoint";

/**
 * Uses a database-backed atomic counter, so parallel server instances share
 * the same mutation quota. null represents a database/configuration failure.
 */
export async function consumeCompetitionActionRateLimit(
  playerId: string,
  action: CompetitionRateLimitAction,
): Promise<boolean | null> {
  const { data, error } = await createAdminClient().rpc("rtw_consume_competition_action_rate_limit", {
    p_player_id: playerId,
    p_action: action,
  });
  if (error || typeof data !== "boolean") return null;
  return data;
}

/** Require a live Auth session before privileged competition operations. */
export async function getVerifiedPlayerId(): Promise<string | null> {
  return (await getVerifiedUserContext())?.userId ?? null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{10,32}$/.test(code) ? code : null;
}

export function getWhatsAppClaimUrl(): string | null {
  const destination = process.env.WHATSAPP_CLAIM_DESTINATION?.trim();
  if (!destination || !/^[1-9]\d{7,14}$/.test(destination)) return null;
  const message = "Greetings, I am a Race To Win winner and I want to claim my prize.";
  return `https://wa.me/${destination}?text=${encodeURIComponent(message)}`;
}

export { RACE_TO_WIN_GAME_SLUG };
