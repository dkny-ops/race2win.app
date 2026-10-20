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
  const [weeklyPrizeCents, setWeeklyPrizeCents] = useState(0);
  const [weeklyRank, setWeeklyRank] = useState<number | null>(null);

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
        const result = await response.json() as { eligible?: boolean; whatsappUrl?: string; prizeCents?: number; rankPosition?: number | null };
        if (result.eligible === true) {
          setWeeklyRank(result.rankPosition === 1 || result.rankPosition === 2 || result.rankPosition === 3 ? result.rankPosition : null);
          setWeeklyPrizeCents(typeof result.prizeCents === "number" && result.prizeCents > 0 ? result.prizeCents : 0);
        }
        if (result.eligible === true && typeof result.whatsappUrl === "string" && result.whatsappUrl.startsWith("https://wa.me/")) {
          setWinnerContact(result.whatsappUrl);
          setWeeklyPrizeCents(typeof result.prizeCents === "number" && result.prizeCents > 0 ? result.prizeCents : 0);
        }
      } catch {
        // Contact is optional and never affects financial state.
      }
    })();
  }, []);

  if (!data && !winnerContact && weeklyPrizeCents === 0) return null;

  return <section className="profile-card" aria-labelledby="claim-prize-title">
    <p className="eyebrow">PRIZE CLAIM</p>
    <h2 id="claim-prize-title">MY WALLET</h2>
    <p className="profile-warning">AVAILABLE BALANCE · {prizeAmount(data?.eligibleBalanceCents ?? 0)}</p>
    {weeklyPrizeCents > 0 ? <p className="profile-warning">{weeklyRank === 1 ? "1er lugar" : weeklyRank === 2 ? "2do lugar" : weeklyRank === 3 ? "3er lugar" : "Premio semanal"} · {prizeAmount(weeklyPrizeCents)}</p> : null}
    <p className="profile-warning">MINIMUM WITHDRAWAL · $10.00</p>
    <p className="profile-warning">Your prize is provisional and remains subject to eligibility and fraud review before payment.</p>
    {winnerContact ? <div className="profile-form">
      <p className="profile-warning">TOP 3 · Tienes 24 horas desde el cierre del torneo para contactar al propietario y validar tu premio.</p>
      <a className="button button--primary" href={winnerContact} target="_blank" rel="noopener noreferrer" aria-label="Contactar por WhatsApp" title="Contactar por WhatsApp" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: "50%", padding: 10 }}><svg viewBox="0 0 32 32" width="32" height="32" role="img" aria-hidden="true" fill="currentColor"><path d="M16 .8A15.1 15.1 0 0 0 3 23.6L.9 31l7.6-2A15.2 15.2 0 1 0 16 .8Zm0 27.6a12.3 12.3 0 0 1-6.3-1.7l-.5-.3-4.5 1.2 1.2-4.4-.3-.5A12.5 12.5 0 1 1 16 28.4Zm6.9-9.3c-.4-.2-2.3-1.1-2.7-1.3-.3-.1-.6-.2-.8.2-.3.4-1 1.3-1.2 1.5-.2.3-.4.3-.8.1-.4-.2-1.6-.6-3.1-1.9-1.1-1-1.9-2.2-2.1-2.6-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.6.1-.3 0-.5 0-.7l-1.2-2.9c-.3-.7-.6-.6-.8-.6h-.7c-.3 0-.7.1-1 .5-.3.4-1.3 1.3-1.3 3.2s1.4 3.7 1.6 3.9c.2.3 2.7 4.1 6.6 5.7.9.4 1.6.6 2.1.7.9.3 1.7.2 2.3.2.7-.1 2.3-1 2.6-2 .3-1 .3-1.8.2-2-.1-.2-.3-.3-.7-.5Z"/></svg></a>
    </div> : null}
  </section>;
}
