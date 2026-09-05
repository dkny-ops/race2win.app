import { NextResponse } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { EMAIL_PATTERN, USERNAME_PATTERN, normalizePayPalEmail, normalizeUsername } from "@/lib/profile-validation";

const UNAUTHORIZED = { message: "Sign in to access your profile." };
const PROFILE_ERROR = { message: "Your profile could not be saved. Please try again." };

type Profile = { username: string | null; paypal_email: string | null };

async function getProfileContext() {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return typeof userId === "string" ? { supabase, userId } : null;
}

async function readOrCreateProfile() {
  const context = await getProfileContext();
  if (!context) return null;

  const { supabase, userId } = context;
  const { error: insertError } = await supabase
    .from("profiles")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (insertError) throw insertError;

  const { data, error } = await supabase
    .from("profiles")
    .select("username, paypal_email")
    .eq("user_id", userId)
    .single<Profile>();
  if (error) throw error;
  return { ...context, profile: data };
}

export async function GET() {
  try {
    const context = await readOrCreateProfile();
    if (!context) return NextResponse.json(UNAUTHORIZED, { status: 401, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ username: context.profile.username, paypalEmail: context.profile.paypal_email }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(PROFILE_ERROR, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    const candidate: unknown = await request.json();
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) throw new Error();
    body = candidate as Record<string, unknown>;
  } catch {
    return NextResponse.json(PROFILE_ERROR, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const context = await readOrCreateProfile();
    if (!context) return NextResponse.json(UNAUTHORIZED, { status: 401, headers: { "Cache-Control": "no-store" } });

    const changes: { username?: string; paypal_email?: string | null } = {};
    if ("username" in body) {
      if (body.acknowledgeUsername !== true || typeof body.username !== "string") {
        return NextResponse.json({ message: "Confirm that your username cannot be changed before saving." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      const username = normalizeUsername(body.username);
      if (!USERNAME_PATTERN.test(username)) {
        return NextResponse.json({ message: "Use 3–20 letters, numbers, or underscores." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      if (context.profile.username) {
        return NextResponse.json({ message: "Your username is already locked." }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
      changes.username = username;
    }
    if ("paypalEmail" in body) {
      if (typeof body.paypalEmail !== "string") return NextResponse.json(PROFILE_ERROR, { status: 400, headers: { "Cache-Control": "no-store" } });
      const paypalEmail = normalizePayPalEmail(body.paypalEmail);
      if (paypalEmail && !EMAIL_PATTERN.test(paypalEmail)) {
        return NextResponse.json({ message: "Enter a valid PayPal email address." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      changes.paypal_email = paypalEmail || null;
    }
    if (Object.keys(changes).length === 0) return NextResponse.json(PROFILE_ERROR, { status: 400, headers: { "Cache-Control": "no-store" } });

    const { data, error } = await context.supabase
      .from("profiles")
      .update(changes)
      .eq("user_id", context.userId)
      .select("username, paypal_email")
      .single<Profile>();
    if (error) {
      const message = error.code === "23505" ? "That username is unavailable." : PROFILE_ERROR.message;
      return NextResponse.json({ message }, { status: error.code === "23505" ? 409 : 400, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ username: data.username, paypalEmail: data.paypal_email }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(PROFILE_ERROR, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
