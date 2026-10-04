"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TurnstileWidget } from "./turnstile-widget";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_MESSAGE = "If this email can receive a sign-in code, check your inbox shortly.";

export function SignInForm({ nextPath = "/", turnstileSiteKey, initialCooldownUntil }: { nextPath?: string; turnstileSiteKey?: string; initialCooldownUntil?: number }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetNonce, setTurnstileResetNonce] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(initialCooldownUntil ?? 0);
  const [now, setNow] = useState(() => Date.now());
  const submitInFlightRef = useRef(false);
  const secondsRemaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1_000));
  const cooldownActive = secondsRemaining > 0;

  useEffect(() => {
    if (!cooldownActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [cooldownActive]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // This is presentation-only. A modified client can submit anyway, but the
    // server-side PostgreSQL limiter remains authoritative.
    if (cooldownActive) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) { setNotice("Enter a valid email address."); return; }
    if (turnstileSiteKey && !turnstileToken) { setNotice("Complete the verification challenge before requesting a code."); return; }
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setIsSubmitting(true); setNotice("");
    try {
      const response = await fetch("/api/auth/request-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizedEmail, next: nextPath, turnstileToken: turnstileSiteKey ? turnstileToken : undefined }) });
      const data: unknown = await response.json();
      const result = typeof data === "object" && data !== null ? data as { message?: unknown; nextStep?: unknown } : null;
      setNotice(result?.message ? String(result.message) : GENERIC_MESSAGE);
      if (result?.nextStep === true) {
        setCooldownUntil(Date.now() + 60_000);
        router.push("/sign-in/verify");
      }
    } catch { setNotice(GENERIC_MESSAGE); }
    finally {
      setIsSubmitting(false);
      submitInFlightRef.current = false;
      if (turnstileSiteKey) setTurnstileResetNonce((value) => value + 1);
    }
  }
  return <form className="sign-in-form" onSubmit={handleSubmit} noValidate><label htmlFor="email">EMAIL ADDRESS</label><input id="email" name="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />{turnstileSiteKey ? <TurnstileWidget siteKey={turnstileSiteKey} onTokenChange={setTurnstileToken} resetNonce={turnstileResetNonce} /> : null}<button className="button button--primary" type="submit" disabled={isSubmitting || cooldownActive}>{isSubmitting ? "SENDING..." : cooldownActive ? `REQUEST ANOTHER CODE IN ${secondsRemaining}s` : "SEND CODE"}</button><p className="sign-in-notice" aria-live="polite">{notice}</p></form>;
}
