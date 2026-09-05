"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_MESSAGE = "If this email can receive a sign-in code, check your inbox shortly.";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) { setNotice("Enter a valid email address."); return; }
    setIsSubmitting(true); setNotice("");
    try {
      const response = await fetch("/api/auth/request-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizedEmail }) });
      const data: unknown = await response.json();
      const result = typeof data === "object" && data !== null ? data as { message?: unknown; nextStep?: unknown } : null;
      setNotice(result?.message ? String(result.message) : GENERIC_MESSAGE);
      if (result?.nextStep === true) router.push("/sign-in/verify");
    } catch { setNotice(GENERIC_MESSAGE); }
    finally { setIsSubmitting(false); }
  }
  return <form className="sign-in-form" onSubmit={handleSubmit} noValidate><label htmlFor="email">EMAIL ADDRESS</label><input id="email" name="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /><button className="button button--primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "SENDING..." : "SEND CODE"}</button><p className="sign-in-notice" aria-live="polite">{notice}</p></form>;
}
