import { NextResponse } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";
import { safePostAuthPath } from "@/lib/auth/post-auth-path";
import { readBoundedJson } from "@/lib/competition/request-body";

const GENERIC_MESSAGE = "If this email can receive a sign-in code, check your inbox shortly.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const requestId = createSecurityRequestId();
  let email = "";
  let nextPath = "/";
  try {
    const body: unknown = await readBoundedJson(request);
    if (body === null) throw new Error("Invalid request body");
    const candidate = typeof body === "object" && body !== null && "email" in body ? (body as { email?: unknown }).email : undefined;
    const nextCandidate = typeof body === "object" && body !== null && "next" in body ? (body as { next?: unknown }).next : undefined;
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
  } else if (!isSupabaseConfigured()) {
    logSecurityEvent({ eventType: "auth.request_code.failed", route: "/api/auth/request-code", requestId, reason: "missing_configuration", status: 202 });
  } else {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      requestAccepted = !error;
      if (error) {
        logSecurityEvent({ eventType: "auth.request_code.failed", route: "/api/auth/request-code", requestId, reason: "provider_rejected", status: 202 });
      }
    } catch {
      // Keep provider failures and account state private from the browser.
      logSecurityEvent({ eventType: "auth.request_code.failed", route: "/api/auth/request-code", requestId, reason: "provider_rejected", status: 202 });
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
  }
  return response;
}
