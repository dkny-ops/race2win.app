import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/routes";
import { SignInForm } from "./sign-in-form";
import { safePostAuthPath } from "@/lib/auth/post-auth-path";
import { getTurnstileRequestWidgetConfiguration } from "@/lib/security/turnstile";

export const metadata: Metadata = { title: "Sign In" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const nextPath = safePostAuthPath((await searchParams).next);
  const context = await getVerifiedUserContext();
  if (context) {
    const { data: profile, error } = await context.supabase.from("profiles").select("username").eq("user_id", context.userId).maybeSingle<{ username: string | null }>();
    if (error) throw new Error("Unable to verify player profile.");
    redirect(profile?.username ? nextPath === ROUTES.home ? ROUTES.profile : nextPath : ROUTES.profile);
  }
  const turnstile = getTurnstileRequestWidgetConfiguration();
  return <section className="sign-in-page"><div className="sign-in-panel"><p className="eyebrow">RACE CONTROL</p><h1>SIGN IN</h1><p className="page-lede">Enter your email to request a one-time sign-in code.</p><SignInForm nextPath={nextPath} turnstileSiteKey={turnstile?.siteKey} /><p className="sign-in-footnote">Use the code from your inbox to complete sign-in.</p><p className="sign-in-footnote">Access error 401? <Link href="/support/access">CONTACTAR SOPORTE</Link></p></div></section>;
}
