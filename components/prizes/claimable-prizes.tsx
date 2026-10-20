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
  const [notice, setNotice] = useState("");
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

  if (!data) return null;

  return <section className="profile-card" aria-labelledby="claim-prize-title">
    <p className="eyebrow">PRIZE CLAIM</p>
    <h2 id="claim-prize-title">MY WALLET</h2>
    <p className="profile-warning">AVAILABLE BALANCE · {prizeAmount(data.eligibleBalanceCents)}</p>
    <p className="profile-warning">PENDING REVIEW · {prizeAmount(data.pendingReviewCents)}</p>
    <p className="profile-warning">MINIMUM WITHDRAWAL · $10.00</p>
    <p className="profile-warning">Your prize is provisional and remains subject to eligibility and fraud review before payment.</p>
    {data.claims.map((claim) => <div className="profile-form" key={claim.id}>
      <p className="profile-warning">{prizeName(claim.awardType)} · {prizeAmount(claim.amountCents)} · PENDING REVIEW</p>
    </div>)}
    {winnerContact ? <div className="profile-form">
      <p className="profile-warning">You finished in the previous tournament's Top 3. Contact the owner to begin manual verification.</p>
      <a className="button button--primary" href={winnerContact} target="_blank" rel="noopener noreferrer">CONTACT OWNER ON WHATSAPP</a>
    </div> : null}
    <p className="profile-status" aria-live="polite">{notice}</p>
  </section>;
}
