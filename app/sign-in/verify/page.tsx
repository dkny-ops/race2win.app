import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { VerifyCodeForm } from "./verify-code-form";
import { ROUTES } from "@/lib/routes";
import { safePostAuthPath } from "@/lib/auth/post-auth-path";
import { BackLink } from "@/components/navigation/back-link";

export const metadata: Metadata = { title: "Check Your Email" };

export default async function VerifyPage() {
  const cookieStore = await cookies();
  const hasActiveRequest = Boolean(cookieStore.get("rtw_otp_email")?.value);
  const nextPath = safePostAuthPath(cookieStore.get("rtw_otp_next")?.value);
  const cooldownCandidate = Number(cookieStore.get("rtw_otp_request_available_at")?.value);
  const initialCooldownUntil = Number.isSafeInteger(cooldownCandidate) && cooldownCandidate > 0 ? cooldownCandidate : undefined;
  const resendHref = `${ROUTES.signIn}?next=${encodeURIComponent(nextPath)}`;
  return <section className="sign-in-page"><div className="sign-in-panel"><BackLink href={resendHref} /><p className="eyebrow">RACE CONTROL</p><h1>CHECK YOUR EMAIL</h1><p className="page-lede">Enter the 6-digit verification code we sent to your email address.</p>{hasActiveRequest ? <VerifyCodeForm initialCooldownUntil={initialCooldownUntil} resendHref={resendHref} /> : <p className="sign-in-notice">There is no active code request. Start again to receive a new code.</p>}<Link className="change-email-link" href={resendHref}>USE A DIFFERENT EMAIL</Link></div></section>;
}
