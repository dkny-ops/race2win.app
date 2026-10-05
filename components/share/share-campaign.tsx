"use client";

import Link from "next/link";
import { useState } from "react";
import { ROUTES } from "@/lib/routes";

type ShareEntry = Readonly<{ rank: number; username: string; confirmedShares: number }>;

function shareUrl(code: string) {
  const url = new URL(window.location.origin);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("unsupported_share_origin");
  url.pathname = "/";
  url.search = `?ref=${encodeURIComponent(code)}`;
  url.hash = "";
  return url.toString();
}

export function ShareCampaign({
  authenticated,
  referralCode,
  tournamentWeek,
  entries,
  unavailable,
}: Readonly<{
  authenticated: boolean;
  referralCode: string | null;
  tournamentWeek: string | null;
  entries: readonly ShareEntry[];
  unavailable: boolean;
}>) {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function sharePersonalLink() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/referrals/code", { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      const code = typeof body === "object" && body !== null && "code" in body && typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : null;
      if (!response.ok || !code) throw new Error("share_unavailable");
      const url = shareUrl(code);
      if (typeof navigator.share === "function") await navigator.share({ title: "Race To Win", text: "Join me on Race To Win.", url });
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); setNotice("Your personal Share link was copied."); }
      else setNotice("Your browser cannot share this link automatically. Please try a current browser.");
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") setNotice("Share canceled.");
      else setNotice("Your Share link is temporarily unavailable. Please try again shortly.");
    } finally { setBusy(false); }
  }

  async function attachReferral() {
    if (!referralCode) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/referrals/attach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: referralCode }) });
      if (!response.ok) throw new Error("referral_rejected");
      setNotice("Referral attached. Only future server-validated activity can qualify it.");
    } catch {
      setNotice("This referral could not be applied.");
    } finally { setBusy(false); }
  }

  const signInHref = referralCode ? `${ROUTES.signIn}?next=${encodeURIComponent(`/?ref=${referralCode}`)}` : `${ROUTES.signIn}?next=${encodeURIComponent(ROUTES.home)}`;
  return <section className="section section-tint" aria-labelledby="share-title"><div className="shell share-campaign">
    <div className="section-heading section-heading--row"><div><p className="eyebrow">WEEKLY SHARE CHALLENGE</p><h2 id="share-title">SHARE RACE TO WIN</h2></div>{authenticated ? <button className="button button--primary" type="button" disabled={busy} onClick={() => void sharePersonalLink()}>{busy ? "WORKING..." : "SHARE THE WEBSITE"}</button> : <Link className="button button--primary" href={signInHref}>SIGN IN TO SHARE</Link>}</div>
    {referralCode ? <div className="share-campaign__invite"><h3>YOU WERE INVITED</h3>{authenticated ? <button className="button button--secondary" type="button" disabled={busy} onClick={() => void attachReferral()}>{busy ? "APPLYING..." : "JOIN WITH THIS INVITE"}</button> : <Link className="button button--secondary" href={signInHref}>SIGN IN TO JOIN</Link>}</div> : null}
    {notice ? <p className="sign-in-notice" role="status">{notice}</p> : null}
    <div className="share-campaign__rules"><p><strong>HOW A SHARE COUNTS</strong> A link click alone does not count. The invited player must sign in, explicitly join through the link, confirm their email, and complete at least 3 server-validated official runs on 5 different New York days in one tournament week. Guest play, browser changes, and unvalidated runs never qualify.</p><p><strong>WEEKLY $10 POOL</strong> The highest server-confirmed Share count leads the week. If leaders tie, the fixed $10 pool is split by the server only after official award generation. Appearing in the Top 10 is not itself a prize award.</p></div>
    <div className="share-campaign__board"><div><p className="eyebrow">CONFIRMED REFERRALS ONLY</p><h3>SHARE TOP 10</h3></div>{unavailable ? <p className="muted" role="status">Share standings are temporarily unavailable.</p> : entries.length === 0 ? <p className="muted">No confirmed Share standings for this week yet.</p> : <><p className="share-campaign__week">TOURNAMENT WEEK · {tournamentWeek} · NEW YORK TIME</p><div className="scores-table scores-table--leaderboard" role="table" aria-label="Weekly Share Top 10"><div className="scores-table__header" role="row"><span>POSITION</span><span>PLAYER</span><span>CONFIRMED SHARES</span></div>{entries.map((entry) => <div role="row" key={`${entry.rank}-${entry.username}`}><strong>#{entry.rank}</strong><span>{entry.username}</span><strong>{entry.confirmedShares}</strong></div>)}</div></>}</div>
    <Link className="share-campaign__rules-link" href={ROUTES.rules}>READ SHARE RULES <span aria-hidden="true">→</span></Link>
  </div></section>;
}
