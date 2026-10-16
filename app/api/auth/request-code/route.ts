import { NextResponse } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";
import { safePostAuthPath } from "@/lib/auth/post-auth-path";
import { readBoundedJson } from "@/lib/competition/request-body";
import { verifyTurnstileToken } from "@/lib/security/turnstile";

const GENERIC_MESSAGE = "If this email can receive a sign-in code, check your inbox shortly.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const requestId = createSecurityRequestId();
  let email = "";
  let nextPath = "/";
  let turnstileToken: unknown;
  let supabaseCaptchaToken: unknown;
  try {
    // Retains the upstream size limit while allowing two opaque CAPTCHA tokens.
    const body: unknown = await readBoundedJson(request, 8 * 1024);
    if (body === null) throw new Error("Invalid request body");
    const candidate = typeof body === "object" && body !== null && "email" in body ? (body as { email?: unknown }).email : undefined;
    const nextCandidate = typeof body === "object" && body !== null && "next" in body ? (body as { next?: unknown }).next : undefined;
    turnstileToken = typeof body === "object" && body !== null && "turnstileToken" in body ? (body as { turnstileToken?: unknown }).turnstileToken : undefined;
    supabaseCaptchaToken = typeof body === "object" && body !== null && "supabaseCaptchaToken" in body ? (body as { supabaseCaptchaToken?: unknown }).supabaseCaptchaToken : undefined;
    if (typeof candidate === "string") email = candidate.trim().toLowerCase();
    nextPath = safePostAuthPath(nextCandidate);
  } catch {
    logSecurityEvent({ eventType: "auth.request_code.rejected", route: "/api/auth/request-code", requestId, reason: "invalid_request", status: 202 });
    return NextResponse.json({ message: GENERIC_MESSAGE, nextStep: false }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }

  let requestAccepted = false;
  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    logSecurityEvent({ eventType: "auth.request_code.rejected", route: "/api/auth/request-code", requestId, reason: "invalid_request", status: 202 });
  } else {
    const turnstile = await verifyTurnstileToken(turnstileToken, "otp_request");
    const captchaDisabled = turnstile.status === "unavailable" && turnstile.reason === "disabled";
    // Siteverify consumes its token. Supabase Auth receives another fresh one.
    const hasIndependentSupabaseToken = typeof supabaseCaptchaToken === "string"
      && supabaseCaptchaToken.trim().length > 0
      && supabaseCaptchaToken.length <= 2048
      && supabaseCaptchaToken !== turnstileToken;
    if (!captchaDisabled && (turnstile.status !== "verified" || !hasIndependentSupabaseToken)) {
      const reason = turnstile.status === "unavailable"
        ? turnstile.reason === "missing_configuration" ? "missing_configuration" : "provider_rejected"
        : "provider_rejected";
      logSecurityEvent({ eventType: "auth.request_code.rejected", route: "/api/auth/request-code", requestId, reason, status: 202 });
    } else if (!isSupabaseConfigured()) {
      logSecurityEvent({ eventType: "auth.request_code.failed", route: "/api/auth/request-code", requestId, reason: "missing_configuration", status: 202 });
    } else {
      try {
        const supabase = await createClient();
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: true,
            ...(turnstile.status === "verified" ? { captchaToken: supabaseCaptchaToken as string } : {}),
          },
        });
        requestAccepted = !error;
        if (error) logSecurityEvent({ eventType: "auth.request_code.failed", route: "/api/auth/request-code", requestId, reason: "provider_rejected", status: 202 });
      } catch {
        // Provider details and recipient state stay private.
        logSecurityEvent({ eventType: "auth.request_code.failed", route: "/api/auth/request-code", requestId, reason: "provider_rejected", status: 202 });
      }
    }
  }

  const response = NextResponse.json({ message: GENERIC_MESSAGE, nextStep: requestAccepted }, { status: 202, headers: { "Cache-Control": "no-store" } });
  if (requestAccepted) {
    response.cookies.set("rtw_otp_email", email, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
    response.cookies.set("rtw_otp_next", nextPath, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  }
  return response;
}
