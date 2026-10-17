"use client";

import { useEffect, useState } from "react";
import { TurnstileScript, TurnstileWidget } from "@/app/sign-in/turnstile-widget";

type Verification = { status?: string; turnstileSiteKey?: string | null; message?: string };

export function PendingRun({ sessionId, score, day }: { sessionId: string; score: number; day: string }) {
  const [verification, setVerification] = useState<Verification | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reset, setReset] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/game-sessions/leader-verification?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unavailable");
        const body = await response.json() as Verification;
        if (!controller.signal.aborted) setVerification(body);
      }).catch(() => { if (!controller.signal.aborted) setNotice("Verification is temporarily unavailable. Your score remains saved."); });
    return () => controller.abort();
  }, [sessionId]);

  async function submit(retry: boolean) {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/game-sessions/leader-verification", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify(retry ? { sessionId, retry: true } : { sessionId, turnstileToken: token }),
      });
      const body = await response.json() as Verification;
      if (!response.ok) throw new Error(body.message ?? "Verification unavailable. Try again.");
      setVerification(body);
      if (body.status === "verified") {
        setNotice("Verification completed. Rankings will refresh automatically.");
        window.dispatchEvent(new Event("rtw:score-verified"));
        window.dispatchEvent(new Event("focus"));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Verification unavailable. Try again.");
      // Refresh disposition after rejection: a challenge can expire while the
      // page is open, and the user must then be offered the restart action.
      try {
        const response = await fetch(`/api/game-sessions/leader-verification?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        if (response.ok) setVerification(await response.json() as Verification);
      } catch { /* Keep the saved result and allow another attempt. */ }
    }
    finally { setToken(null); setReset((value) => value + 1); setBusy(false); }
  }

  return <section className="scores-message" aria-label={`Pending score ${score} on ${day}`}>
    <p><strong>{day} · {score.toLocaleString()} points · {verification?.status === "verified" ? "VERIFIED" : "PENDING REVIEW"}</strong></p>
    {verification?.status !== "verified" ? <p>This saved run is excluded from the weekly total and world ranking while verification is pending.</p> : null}
    {verification?.status === "expired" ? <button className="button button--secondary" disabled={busy} onClick={() => void submit(true)}>RESTART HUMAN VERIFICATION</button>
      : verification?.status === "pending" && verification.turnstileSiteKey ? <>
        <TurnstileScript onReady={() => setReady(true)} onError={() => { setReady(false); setNotice("Could not load verification. Refresh to try again."); }} />
        <TurnstileWidget siteKey={verification.turnstileSiteKey} action="weekly_leader_verification" scriptReady={ready} resetNonce={reset} label="Weekly leader human verification" onTokenChange={setToken} />
        <button className="button button--secondary" disabled={busy || !token} onClick={() => void submit(false)}>{busy ? "VERIFYING…" : "VERIFY THIS RUN"}</button>
      </> : verification && verification.status !== "verified" ? <p>Human verification is unavailable or this run requires review. Your result remains saved.</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </section>;
}
