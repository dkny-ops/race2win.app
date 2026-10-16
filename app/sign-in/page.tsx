import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SignInForm } from "./sign-in-form";
import { safePostAuthPath } from "@/lib/auth/post-auth-path";
import { getTurnstileRequestWidgetConfiguration } from "@/lib/security/turnstile";
import { BackLink } from "@/components/navigation/back-link";

export const metadata: Metadata = { title: "Sign In" };
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const nextPath = safePostAuthPath((await searchParams).next);
  const turnstile = getTurnstileRequestWidgetConfiguration();
  const cooldownCandidate = Number((await cookies()).get("rtw_otp_request_available_at")?.value);
  // This cookie only restores a display countdown. The client treats stale
  // values as zero, while PostgreSQL authorizes every real resend.
  const initialCooldownUntil = Number.isSafeInteger(cooldownCandidate) && cooldownCandidate > 0 ? cooldownCandidate : undefined;
  return <section className="sign-in-page"><div className="sign-in-panel"><BackLink href={nextPath} /><p className="eyebrow">RACE CONTROL</p><h1>SIGN IN</h1><p className="page-lede">Enter your email to request a one-time sign-in code.</p><SignInForm nextPath={nextPath} turnstileSiteKey={turnstile?.siteKey} initialCooldownUntil={initialCooldownUntil} /><p className="sign-in-footnote">Use the code from your inbox to complete sign-in.</p></div></section>;
}
