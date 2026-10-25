"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TurnstileScript, TurnstileWidget } from "./turnstile-widget";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_MESSAGE = "If this email can receive a sign-in code, check your inbox shortly.";

export function SignInForm({ nextPath = "/", turnstileSiteKey, adaptiveSiteKey }: Readonly<{ nextPath?: string; turnstileSiteKey?: string; adaptiveSiteKey?: string }>) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [supabaseCaptchaToken, setSupabaseCaptchaToken] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [turnstileResetNonce, setTurnstileResetNonce] = useState(0);
  const submitInFlightRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) { setNotice("Enter a valid email address."); return; }
    if (!adaptiveSiteKey || !turnstileSiteKey) { setNotice("Verification temporarily unavailable. Try again shortly."); return; }
    if (!turnstileToken || !supabaseCaptchaToken) { setNotice("Please wait for verification and complete the check if shown."); return; }
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setIsSubmitting(true); setNotice("");
    try {
      const response = await fetch("/api/auth/request-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, next: nextPath, turnstileToken, supabaseCaptchaToken }),
      });
      const data: unknown = await response.json();
      const result = typeof data === "object" && data !== null ? data as { message?: unknown; nextStep?: unknown } : null;
      setNotice(result?.message ? String(result.message) : GENERIC_MESSAGE);
      if (result?.nextStep === true) router.push("/sign-in/verify");
    } catch { setNotice(GENERIC_MESSAGE); }
    finally {
      setIsSubmitting(false);
      submitInFlightRef.current = false;
      if (turnstileSiteKey) {
        setTurnstileToken(null);
        setSupabaseCaptchaToken(null);
        setTurnstileResetNonce((nonce) => nonce + 1);
      }
    }
  }

  const configured = Boolean(adaptiveSiteKey && turnstileSiteKey);
  return <form className="sign-in-form" onSubmit={handleSubmit} noValidate>
    <label htmlFor="email">EMAIL ADDRESS</label>
    <input id="email" name="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
    {adaptiveSiteKey && turnstileSiteKey ? <>
      <TurnstileScript onReady={() => setScriptReady(true)} onError={() => { setScriptReady(false); setTurnstileToken(null); setSupabaseCaptchaToken(null); setNotice("Verification could not load. Refresh the page to try again."); }} />
      <TurnstileWidget label="Race To Win adaptive verification" siteKey={adaptiveSiteKey} adaptive scriptReady={scriptReady} resetNonce={turnstileResetNonce} onTokenChange={setTurnstileToken} />
      <TurnstileWidget label="Supabase email verification" siteKey={turnstileSiteKey} scriptReady={scriptReady} resetNonce={turnstileResetNonce} onTokenChange={setSupabaseCaptchaToken} />
    </> : <p role="status">Verification temporarily unavailable. Try again shortly.</p>}
    <button className="button button--primary" type="submit" disabled={isSubmitting || !configured}>{isSubmitting ? "SENDING..." : "SEND CODE"}</button>
    <p className="sign-in-notice" aria-live="polite">{notice}</p>
  </form>;
}
