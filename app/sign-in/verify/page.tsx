import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { VerifyCodeForm } from "./verify-code-form";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Check Your Email" };

export default async function VerifyPage() {
  const hasActiveRequest = Boolean((await cookies()).get("rtw_otp_email")?.value);
  return <section className="sign-in-page"><div className="sign-in-panel"><p className="eyebrow">RACE CONTROL</p><h1>CHECK YOUR EMAIL</h1><p className="page-lede">Enter the 6-digit verification code we sent to your email address.</p>{hasActiveRequest ? <VerifyCodeForm /> : <p className="sign-in-notice">There is no active code request. Start again to receive a new code.</p>}<Link className="change-email-link" href={ROUTES.signIn}>USE A DIFFERENT EMAIL</Link></div></section>;
}
