"use client";

import Link from "next/link";
import { useState } from "react";
import { ROUTES } from "@/lib/routes";

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
}: Readonly<{
  authenticated: boolean;
  referralCode: string | null;
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

  async function shareVia(service: "whatsapp" | "facebook" | "x" | "telegram" | "copy") {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/referrals/code", { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      const code = typeof body === "object" && body !== null && "code" in body && typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : null;
      if (!response.ok || !code) throw new Error("share_unavailable");
      const url = shareUrl(code);
      if (service === "copy") { await navigator.clipboard?.writeText(url); setNotice("Your personal Share link was copied."); return; }
      const encoded = encodeURIComponent(url);
      const target = service === "whatsapp" ? `https://wa.me/?text=${encoded}` : service === "facebook" ? `https://www.facebook.com/sharer/sharer.php?u=${encoded}` : service === "x" ? `https://x.com/intent/post?url=${encoded}` : `https://t.me/share/url?url=${encoded}`;
      window.open(target, "_blank", "noopener,noreferrer");
      setNotice("Share window opened. Sharing is optional and does not award points or prizes.");
    } catch { setNotice("Your Share link is temporarily unavailable. Please try again shortly."); }
    finally { setBusy(false); }
  }

  async function attachReferral() {
    if (!referralCode) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/referrals/attach", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: referralCode }) });
      if (!response.ok) throw new Error("referral_rejected");
      setNotice("Invitation attached. Sharing is optional and does not create points, prizes, credits, or tournament eligibility.");
    } catch {
      setNotice("This referral could not be applied.");
    } finally { setBusy(false); }
  }

  const signInHref = referralCode ? `${ROUTES.signIn}?next=${encodeURIComponent(`/?ref=${referralCode}`)}` : `${ROUTES.signIn}?next=${encodeURIComponent(ROUTES.home)}`;
  return <section className="section section-tint" aria-labelledby="share-title"><div className="shell share-campaign">
    <div className="section-heading section-heading--row"><div><p className="eyebrow">SHARE RACE TO WIN</p><h2 id="share-title">INVITE YOUR FRIENDS</h2></div>{authenticated ? <button className="button button--primary" type="button" disabled={busy} onClick={() => void sharePersonalLink()}>{busy ? "WORKING..." : "SHARE THE WEBSITE"}</button> : <Link className="button button--primary" href={signInHref}>SIGN IN TO SHARE</Link>}</div>
    {referralCode ? <div className="share-campaign__invite"><h3>YOU WERE INVITED</h3>{authenticated ? <button className="button button--secondary" type="button" disabled={busy} onClick={() => void attachReferral()}>{busy ? "APPLYING..." : "JOIN WITH THIS INVITE"}</button> : <Link className="button button--secondary" href={signInHref}>SIGN IN TO JOIN</Link>}</div> : null}
    {notice ? <p className="sign-in-notice" role="status">{notice}</p> : null}
    <div className="share-campaign__rules"><p><strong>OPTIONAL SOCIAL SHARE</strong> Share your personal invitation link if you want. Sharing does not create points, prizes, credits, rankings, or tournament eligibility.</p><div className="share-campaign__services" aria-label="Share services"><button type="button" disabled={busy || !authenticated} onClick={() => void shareVia("whatsapp")}>WHATSAPP</button><button type="button" disabled={busy || !authenticated} onClick={() => void shareVia("facebook")}>FACEBOOK</button><button type="button" disabled={busy || !authenticated} onClick={() => void shareVia("x")}>X</button><button type="button" disabled={busy || !authenticated} onClick={() => void shareVia("telegram")}>TELEGRAM</button><button type="button" disabled={busy || !authenticated} onClick={() => void shareVia("copy")}>COPY LINK</button></div></div>
    <Link className="share-campaign__rules-link" href={ROUTES.rules}>READ TOURNAMENT RULES <span aria-hidden="true">→</span></Link>
  </div></section>;
}
