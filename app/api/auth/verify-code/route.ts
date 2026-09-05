import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const OTP_PATTERN = /^\d{6}$/;
const INVALID_CODE_MESSAGE = "That code is invalid or expired. Request a new code and try again.";

export async function POST(request: NextRequest) {
  let token = "";
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && "token" in body) {
      const candidate = (body as { token?: unknown }).token;
      if (typeof candidate === "string") token = candidate.trim();
    }
  } catch { /* Return the same safe error below. */ }

  const email = request.cookies.get("rtw_otp_email")?.value;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!email || !url || !publishableKey || !OTP_PATTERN.test(token)) {
    return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  let response = NextResponse.redirect(new URL("/", request.url), 303);
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
    return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  response.cookies.set("rtw_otp_email", "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 0, path: "/" });
  return response;
}
