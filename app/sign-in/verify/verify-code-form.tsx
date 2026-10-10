"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { safePostAuthPath } from "@/lib/auth/post-auth-path";

const OTP_PATTERN = /^\d{6}$/;

export function VerifyCodeForm({ initialCooldownUntil, resendHref }: { initialCooldownUntil?: number; resendHref: string }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const secondsRemaining = Math.max(0, Math.ceil(((initialCooldownUntil ?? 0) - now) / 1_000));

  useEffect(() => {
    if (secondsRemaining <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [secondsRemaining]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!OTP_PATTERN.test(token)) { setNotice("Enter the 6-digit code from your email."); return; }
    setIsSubmitting(true); setNotice("");
    try {
      const response = await fetch("/api/auth/verify-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data: unknown = await response.json();
      if (response.ok) {
        const nextPath = safePostAuthPath(typeof data === "object" && data !== null && "nextPath" in data ? (data as { nextPath?: unknown }).nextPath : undefined);
        router.replace(nextPath); router.refresh(); return;
      }
      setNotice(typeof data === "object" && data !== null && "message" in data ? String((data as { message: unknown }).message) : "That code is invalid or expired. Request a new code and try again.");
    } catch { setNotice("That code is invalid or expired. Request a new code and try again."); }
    finally { setIsSubmitting(false); }
  }

  return <form className="sign-in-form" onSubmit={handleSubmit} noValidate><label htmlFor="verification-code">VERIFICATION CODE</label><input id="verification-code" name="token" type="text" inputMode="numeric" autoComplete="one-time-code" value={token} onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" required /><button className="button button--primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "VERIFYING..." : "VERIFY CODE"}</button><p className="sign-in-notice" aria-live="polite">{notice}</p>{secondsRemaining > 0 ? <p className="sign-in-footnote" aria-live="polite">REQUEST ANOTHER CODE IN {secondsRemaining}s</p> : <Link className="change-email-link" href={resendHref}>REQUEST ANOTHER CODE</Link>}</form>;
}
