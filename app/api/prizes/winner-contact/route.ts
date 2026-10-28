import { NextResponse } from "next/server";
import { getVerifiedPlayerId, getWhatsAppClaimUrl, NO_STORE_HEADERS } from "@/lib/competition/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function safeCents(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export async function GET() {
  try {
    const playerId = await getVerifiedPlayerId();
    if (!playerId) return NextResponse.json({ eligible: false }, { status: 401, headers: NO_STORE_HEADERS });
    if (!isAdminConfigured()) return NextResponse.json({ eligible: false }, { headers: NO_STORE_HEADERS });

    const admin = createAdminClient();
    const [{ data: balance, error: balanceError }, { data: profile, error: profileError }] = await Promise.all([
      admin.from("prize_balances").select("available_cents").eq("player_id", playerId).maybeSingle(),
      admin.from("profiles").select("username").eq("user_id", playerId).maybeSingle(),
    ]);
    if (balanceError || profileError || safeCents(balance?.available_cents) < 2000) {
      return NextResponse.json({ eligible: false }, { headers: NO_STORE_HEADERS });
    }

    const { data: award, error } = await admin.from("provisional_winners")
      .select("id,status,paid_at,amount_cents,allocation_status,rank_position,game_id,games!inner(display_name,slug)")
      .eq("player_id", playerId)
      .eq("award_type", "weekly_tournament")
      .eq("status", "approved_for_payment")
      .eq("allocation_status", "allocated")
      .is("paid_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !award || typeof award.id !== "string" || typeof award.amount_cents !== "number") {
      return NextResponse.json({ eligible: false }, { headers: NO_STORE_HEADERS });
    }

    const { data: contactClosed, error: closureError } = await admin.rpc("rtw_is_winner_contact_closed", { p_winner: award.id });
    if (closureError || contactClosed === true) return NextResponse.json({ eligible: false }, { headers: NO_STORE_HEADERS });

    const game = award.games as unknown;
    const gameName = game && typeof game === "object" && "display_name" in game && (game as { display_name?: unknown }).display_name === "FlappyRace"
      ? "FlappyRace" : "Race To Win";
    const whatsappUrl = getWhatsAppClaimUrl(profile?.username ?? undefined, gameName);
    return NextResponse.json({
      eligible: Boolean(whatsappUrl),
      prizeCents: award.amount_cents,
      rankPosition: award.rank_position === 1 || award.rank_position === 2 || award.rank_position === 3 ? award.rank_position : null,
      whatsappUrl: whatsappUrl ?? null,
    }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ eligible: false }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
