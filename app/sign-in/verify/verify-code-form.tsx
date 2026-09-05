"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const OTP_PATTERN = /^\d{6}$/;

export function VerifyCodeForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!OTP_PATTERN.test(token)) { setNotice("Enter the 6-digit code from your email."); return; }
    setIsSubmitting(true); setNotice("");
    try {
      const response = await fetch("/api/auth/verify-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      if (response.ok) { router.replace("/"); router.refresh(); return; }
      const data: unknown = await response.json();
      setNotice(typeof data === "object" && data !== null && "message" in data ? String((data as { message: unknown }).message) : "That code is invalid or expired. Request a new code and try again.");
    } catch { setNotice("That code is invalid or expired. Request a new code and try again."); }
    finally { setIsSubmitting(false); }
  }

  return <form className="sign-in-form" onSubmit={handleSubmit} noValidate><label htmlFor="verification-code">VERIFICATION CODE</label><input id="verification-code" name="token" type="text" inputMode="numeric" autoComplete="one-time-code" value={token} onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" required /><button className="button button--primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "VERIFYING..." : "VERIFY CODE"}</button><p className="sign-in-notice" aria-live="polite">{notice}</p></form>;
}
