import { NextResponse } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

const GENERIC_MESSAGE = "If this email can receive a sign-in code, check your inbox shortly.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let email = "";
  try {
    const body: unknown = await request.json();
    const candidate = typeof body === "object" && body !== null && "email" in body ? (body as { email?: unknown }).email : undefined;
    if (typeof candidate === "string") email = candidate.trim().toLowerCase();
  } catch {
    return NextResponse.json(
      { message: GENERIC_MESSAGE, nextStep: false },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }

  let requestAccepted = false;
  if (EMAIL_PATTERN.test(email) && email.length <= 320 && isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      requestAccepted = !error;
    } catch { /* Keep provider failures and account state private. */ }
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
  }
  return response;
}
