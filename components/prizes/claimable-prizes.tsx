"use client";

import { useEffect, useState } from "react";

import type { ClaimablePrize, ClaimablePrizeResponse } from "@/lib/competition/types";

function prizeName(type: ClaimablePrize["awardType"]) {
  return type === "weekly_tournament" ? "WEEKLY TOURNAMENT" : "WEEKLY SHARES";
}

function prizeAmount(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function ClaimablePrizes() {
  const [data, setData] = useState<ClaimablePrizeResponse | null>(null);
  const [winnerContact, setWinnerContact] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/prizes/claimable", { cache: "no-store" });
        if (!response.ok) return;
        const responseData = await response.json() as ClaimablePrizeResponse;
        setData(responseData);
      } catch {
        // Prize eligibility is intentionally quiet here; no client value is authoritative.
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/prizes/winner-contact", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { eligible?: boolean; whatsappUrl?: string };
        if (result.eligible === true && typeof result.whatsappUrl === "string" && result.whatsappUrl.startsWith("https://wa.me/")) {
          setWinnerContact(result.whatsappUrl);
        }
      } catch {
        // Contact is optional and never affects financial state.
      }
    })();
  }, []);

  if (!data && !winnerContact) return null;

  return <section className="profile-card" aria-labelledby="claim-prize-title">
    <p className="eyebrow">PRIZE CLAIM</p>
    <h2 id="claim-prize-title">MY WALLET</h2>
    <p className="profile-warning">AVAILABLE BALANCE · {prizeAmount(data?.eligibleBalanceCents ?? 0)}</p>
    <p className="profile-warning">PENDING REVIEW · {prizeAmount(data?.pendingReviewCents ?? 0)}</p>
    <p className="profile-warning">MINIMUM WITHDRAWAL · $10.00</p>
    <p className="profile-warning">Your prize is provisional and remains subject to eligibility and fraud review before payment.</p>
    {(data?.claims ?? []).map((claim) => <div className="profile-form" key={claim.id}>
      <p className="profile-warning">{prizeName(claim.awardType)} · {prizeAmount(claim.amountCents)} · PENDING REVIEW</p>
    </div>)}
    {winnerContact ? <div className="profile-form">
      <p className="profile-warning">TOP 3 · Tienes 24 horas desde el cierre del torneo para contactar al propietario y validar tu premio.</p>
      <a className="button button--primary" href={winnerContact} target="_blank" rel="noopener noreferrer">CONTACT OWNER ON WHATSAPP</a>
    </div> : null}
  </section>;
}
