import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { VerifyCodeForm } from "./verify-code-form";
import { ROUTES } from "@/lib/routes";
import { safePostAuthPath } from "@/lib/auth/post-auth-path";

export const metadata: Metadata = { title: "Check Your Email" };

export default async function VerifyPage() {
  const cookieStore = await cookies();
  const hasActiveRequest = Boolean(cookieStore.get("rtw_otp_email")?.value);
  const nextPath = safePostAuthPath(cookieStore.get("rtw_otp_next")?.value);
  return <section className="sign-in-page"><div className="sign-in-panel"><p className="eyebrow">RACE CONTROL</p><h1>CHECK YOUR EMAIL</h1><p className="page-lede">Enter the 6-digit verification code we sent to your email address.</p>{hasActiveRequest ? <VerifyCodeForm /> : <p className="sign-in-notice">There is no active code request. Start again to receive a new code.</p>}<Link className="change-email-link" href={`${ROUTES.signIn}?next=${encodeURIComponent(nextPath)}`}>USE A DIFFERENT EMAIL</Link></div></section>;
}
