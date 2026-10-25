import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";
import { safePostAuthPath } from "@/lib/auth/post-auth-path";
import { readBoundedJson } from "@/lib/competition/request-body";
import { consumeOtpAbuseLimit } from "@/lib/auth/otp-abuse";

const OTP_PATTERN = /^\d{6}$/;
const INVALID_CODE_MESSAGE = "That code is invalid or expired. Request a new code and try again.";

export async function POST(request: NextRequest) {
  const requestId = createSecurityRequestId();
  let token = "";
  try {
    const body: unknown = await readBoundedJson(request);
    if (typeof body === "object" && body !== null && "token" in body) {
      const candidate = (body as { token?: unknown }).token;
      if (typeof candidate === "string") token = candidate.trim();
    }
  } catch { /* Return the same safe error below. */ }

  const email = request.cookies.get("rtw_otp_email")?.value;
  const nextPath = safePostAuthPath(request.cookies.get("rtw_otp_next")?.value);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!email || !url || !publishableKey || !OTP_PATTERN.test(token)) {
    logSecurityEvent({ eventType: "auth.verify_code.rejected", route: "/api/auth/verify-code", requestId, reason: "invalid_request", status: 400 });
    return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const quota = await consumeOtpAbuseLimit("otp_verify", email);
  if (quota !== "allowed") {
    const status = quota === "blocked" ? 429 : 503;
    logSecurityEvent({ eventType: "auth.verify_code.rejected", route: "/api/auth/verify-code", requestId, reason: quota === "blocked" ? "rate_limited" : "database_operation_failed", status });
    return NextResponse.json({ message: quota === "blocked" ? "Please wait a minute before trying again." : "Verification temporarily unavailable. Try again shortly." }, { status, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }

  const response = NextResponse.json({ nextPath }, { headers: { "Cache-Control": "no-store" } });
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  try {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error) throw error;
  } catch {
    logSecurityEvent({ eventType: "auth.verify_code.failed", route: "/api/auth/verify-code", requestId, reason: "provider_rejected", status: 400 });
    return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  response.cookies.set("rtw_otp_email", "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 0, path: "/" });
  response.cookies.set("rtw_otp_next", "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 0, path: "/" });
  return response;
}
