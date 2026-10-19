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
  const [claimingId, setClaimingId] = useState<string | null>(null);

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

  async function beginBalanceClaim() {
    setClaimingId("balance");
    setNotice("");
    try {
      const response = await fetch("/api/prizes/balance-claim", { method: "POST" });
      const result = await response.json() as { whatsappUrl?: unknown; message?: unknown };
      if (!response.ok || typeof result.whatsappUrl !== "string") {
        setNotice(typeof result.message === "string" ? result.message : "Prize claim is unavailable.");
        return;
      }
      window.location.assign(result.whatsappUrl);
    } catch {
      setNotice("Prize claim is unavailable.");
    } finally {
      setClaimingId(null);
    }
  }

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
    {data.eligibleBalanceCents >= 1000 ? <div className="profile-form">
      <p className="profile-warning">AVAILABLE PRIZE BALANCE · {prizeAmount(data.eligibleBalanceCents)}</p>
      {data.canContactWhatsApp ? <button className="button button--primary" type="button" disabled={claimingId !== null} onClick={() => void beginBalanceClaim()}>{claimingId === "balance" ? "OPENING WHATSAPP..." : "CLAIM AVAILABLE BALANCE"}</button> : null}
    </div> : null}
    {data.eligibleBalanceCents < 1000 ? <p className="profile-warning">CLAIM PRIZE unlocks at $10.00 available balance.</p> : null}
    <p className="profile-status" aria-live="polite">{notice}</p>
  </section>;
}
