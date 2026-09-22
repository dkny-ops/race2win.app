import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";
import { safePostAuthPath } from "@/lib/auth/post-auth-path";

export const metadata: Metadata = { title: "Sign In" };
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const nextPath = safePostAuthPath((await searchParams).next);
  return <section className="sign-in-page"><div className="sign-in-panel"><p className="eyebrow">RACE CONTROL</p><h1>SIGN IN</h1><p className="page-lede">Enter your email to request a one-time sign-in code.</p><SignInForm nextPath={nextPath} /><p className="sign-in-footnote">Use the code from your inbox to complete sign-in.</p></div></section>;
}
