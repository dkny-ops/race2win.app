import { NextResponse } from "next/server";

import {
  consumeCompetitionActionRateLimit,
  getVerifiedPlayerId,
  NO_STORE_HEADERS,
  normalizeReferralCode,
  RACE_TO_WIN_GAME_SLUG,
  readBoundedJson,
} from "@/lib/competition/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function parseCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 1) return null;
  return normalizeReferralCode(body.code);
}

export async function POST(request: Request) {
  try {
    const code = parseCode(await readBoundedJson(request));
    if (!code) return NextResponse.json({ message: "Referral could not be applied." }, { status: 400, headers: NO_STORE_HEADERS });
    const playerId = await getVerifiedPlayerId();
    if (!playerId) return NextResponse.json({ message: "Sign in to use a referral." }, { status: 401, headers: NO_STORE_HEADERS });
    if (!isAdminConfigured()) return NextResponse.json({ message: "Referral links are unavailable." }, { status: 503, headers: NO_STORE_HEADERS });

    const allowed = await consumeCompetitionActionRateLimit(playerId, "referral_attach");
    if (allowed === false) return NextResponse.json({ message: "Please wait before trying another referral." }, { status: 429, headers: NO_STORE_HEADERS });
    if (allowed === null) return NextResponse.json({ message: "Referral links are unavailable." }, { status: 503, headers: NO_STORE_HEADERS });

    const { error } = await createAdminClient().rpc("rtw_attach_referral", {
      p_invitee_user_id: playerId,
      p_game_slug: RACE_TO_WIN_GAME_SLUG,
      p_code: code,
    });
    if (error) return NextResponse.json({ message: "Referral could not be applied." }, { status: 409, headers: NO_STORE_HEADERS });
    return NextResponse.json({ attached: true }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ message: "Referral could not be applied." }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
