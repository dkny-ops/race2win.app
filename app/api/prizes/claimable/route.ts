import { NextResponse } from "next/server";

import { getVerifiedPlayerId, getWhatsAppClaimUrl, NO_STORE_HEADERS } from "@/lib/competition/server";
import type { ClaimablePrize, ClaimablePrizeResponse } from "@/lib/competition/types";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function safeCents(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }
  return 0;
}

export async function GET() {
  try {
    const playerId = await getVerifiedPlayerId();
    if (!playerId) return NextResponse.json({ message: "Sign in to view prizes." }, { status: 401, headers: NO_STORE_HEADERS });
    if (!isAdminConfigured()) return NextResponse.json({ claims: [], canContactWhatsApp: false, eligibleBalanceCents: 0 } satisfies ClaimablePrizeResponse, { headers: NO_STORE_HEADERS });

    const { data, error } = await createAdminClient()
      .from("provisional_winners")
      .select("id, award_type, amount_cents, claim_deadline_at")
      .eq("player_id", playerId)
      .eq("status", "provisional")
      .eq("allocation_status", "allocated")
      .gte("claim_deadline_at", new Date().toISOString())
      .order("claim_deadline_at", { ascending: true });
    if (error) throw error;

    const { data: balance, error: balanceError } = await createAdminClient()
      .from("prize_balances")
      .select("available_cents")
      .eq("player_id", playerId)
      .maybeSingle();
    if (balanceError) throw balanceError;
    const claims: ClaimablePrize[] = (data ?? []).flatMap((row) => {
      if (
        typeof row.id !== "string" ||
        (row.award_type !== "weekly_tournament" && row.award_type !== "weekly_shares") ||
        typeof row.amount_cents !== "number" ||
        typeof row.claim_deadline_at !== "string"
      ) return [];
      return [{ id: row.id, awardType: row.award_type, amountCents: row.amount_cents, claimDeadlineAt: row.claim_deadline_at }];
    });
    const availableBalance = safeCents(balance?.available_cents);
    return NextResponse.json({ claims, canContactWhatsApp: Boolean(getWhatsAppClaimUrl()), eligibleBalanceCents: availableBalance >= 1000 ? availableBalance : 0 } satisfies ClaimablePrizeResponse, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ message: "Prize information is unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
