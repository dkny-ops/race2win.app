import { NextResponse } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";
import { safePostAuthPath } from "@/lib/auth/post-auth-path";
import { consumeOtpAbuseLimit } from "@/lib/auth/otp-abuse";
import { readBoundedJson } from "@/lib/competition/request-body";
import { verifyTurnstileToken } from "@/lib/security/turnstile";

const GENERIC_MESSAGE = "If this email can receive a sign-in code, check your inbox shortly.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Keep provider details out of browser responses and logs. These categories
 * distinguish an Auth response, an Auth throttle, and an unavailable provider
 * without serializing a provider message, recipient, token, or credentials.
 */
function authProviderFailureReason(error: unknown): "provider_rejected" | "provider_rate_limited" | "provider_unavailable" {
  if (typeof error !== "object" || error === null) return "provider_unavailable";
  const status = "status" in error && typeof error.status === "number" ? error.status : undefined;
  if (status === 429) return "provider_rate_limited";
  if (status !== undefined && status >= 500) return "provider_unavailable";
  return "provider_rejected";
}

export async function POST(request: Request) {
  const requestId = createSecurityRequestId();
  let email = "";
  let nextPath = "/";
  let turnstileToken: unknown;
  try {
    const body: unknown = await readBoundedJson(request);
    if (body === null) throw new Error("Invalid request body");
    const candidate = typeof body === "object" && body !== null && "email" in body ? (body as { email?: unknown }).email : undefined;
    const nextCandidate = typeof body === "object" && body !== null && "next" in body ? (body as { next?: unknown }).next : undefined;
    turnstileToken = typeof body === "object" && body !== null && "turnstileToken" in body ? (body as { turnstileToken?: unknown }).turnstileToken : undefined;
    if (typeof candidate === "string") email = candidate.trim().toLowerCase();
    nextPath = safePostAuthPath(nextCandidate);
  } catch {
    logSecurityEvent({ eventType: "auth.request_code.rejected", route: "/api/auth/request-code", requestId, reason: "invalid_request", status: 202 });
    return NextResponse.json(
      { message: GENERIC_MESSAGE, nextStep: false },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }

  let requestAccepted = false;
  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    logSecurityEvent({ eventType: "auth.request_code.rejected", route: "/api/auth/request-code", requestId, reason: "invalid_request", status: 202 });
  } else {
    const turnstileDecision = await verifyTurnstileToken(turnstileToken, "otp_request");
    if (turnstileDecision.status !== "verified" && !(turnstileDecision.status === "unavailable" && turnstileDecision.reason === "disabled")) {
      logSecurityEvent({ eventType: "auth.request_code.rejected", route: "/api/auth/request-code", requestId, reason: turnstileDecision.status === "unavailable" ? "missing_configuration" : "provider_rejected", status: 202 });
    } else {
      const abuseDecision = await consumeOtpAbuseLimit("otp_request", email);
      if (abuseDecision !== "allowed") {
        logSecurityEvent({ eventType: "auth.request_code.rejected", route: "/api/auth/request-code", requestId, reason: abuseDecision === "blocked" ? "rate_limited" : "abuse_protection_unavailable", status: 202 });
      } else if (!isSupabaseConfigured()) {
        logSecurityEvent({ eventType: "auth.request_code.failed", route: "/api/auth/request-code", requestId, reason: "missing_configuration", status: 202 });
      } else {
        try {
          const supabase = await createClient();
          const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
          requestAccepted = !error;
          if (error) {
            logSecurityEvent({ eventType: "auth.request_code.failed", route: "/api/auth/request-code", requestId, reason: authProviderFailureReason(error), status: 202 });
          }
        } catch {
          // Keep provider failures and account state private from the browser.
          logSecurityEvent({ eventType: "auth.request_code.failed", route: "/api/auth/request-code", requestId, reason: "provider_unavailable", status: 202 });
        }
      }
    }
  }

  const response = NextResponse.json(
    { message: GENERIC_MESSAGE, nextStep: requestAccepted },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
  if (requestAccepted) {
    response.cookies.set("rtw_otp_email", email, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/",
    });
    response.cookies.set("rtw_otp_next", nextPath, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/",
    });
    // Convenience-only UI state. The database abuse limiter remains the sole
    // authority for whether another OTP request may reach Supabase Auth.
    response.cookies.set("rtw_otp_request_available_at", String(Date.now() + 60_000), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60,
      path: "/",
    });
  }
  return response;
}
