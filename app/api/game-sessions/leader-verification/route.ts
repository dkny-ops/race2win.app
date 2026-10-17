import { NextResponse } from "next/server";
import { OFFICIAL_SESSION_UUID, readOfficialSessionJson } from "@/lib/game/race-to-win/official-inputs";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";
import { getTurnstileWidgetConfiguration, verifyTurnstileToken } from "@/lib/security/turnstile";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const runtime = "nodejs";
const CACHE = { "Cache-Control": "no-store" };

type VerificationRow = Readonly<{ required: boolean; status: "pending" | "verified" | "expired"; expires_at: string; widget_required: boolean }>;

function sessionIdFromUrl(request: Request): string | null {
  const value = new URL(request.url).searchParams.get("sessionId");
  return value && OFFICIAL_SESSION_UUID.test(value) ? value : null;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

async function currentUserId(): Promise<string | null> {
  return (await getVerifiedUserContext())?.userId ?? null;
}

async function readVerification(sessionId: string, playerId: string): Promise<VerificationRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("rtw_read_weekly_leader_human_verification", { p_session_id: sessionId, p_player_id: playerId });
  if (error) throw error;
  const row = data?.[0] as VerificationRow | undefined;
  return row?.required === true && (row.status === "pending" || row.status === "verified" || row.status === "expired") ? row : null;
}

export async function GET(request: Request) {
  const requestId = createSecurityRequestId();
  try {
    const sessionId = sessionIdFromUrl(request);
    const playerId = await currentUserId();
    if (!sessionId || !playerId) return NextResponse.json({ message: "Verification unavailable." }, { status: 404, headers: CACHE });
    if (!isAdminConfigured()) return NextResponse.json({ message: "Verification unavailable." }, { status: 503, headers: CACHE });
    const verification = await readVerification(sessionId, playerId);
    if (!verification) return NextResponse.json({ required: false }, { headers: CACHE });
    const widget = verification.widget_required && verification.status === "pending"
      ? getTurnstileWidgetConfiguration("weekly_leader_verification")
      : null;
    return NextResponse.json({
      required: verification.status !== "verified",
      status: verification.status,
      expiresAt: verification.expires_at,
      turnstileSiteKey: widget?.siteKey ?? null,
    }, { headers: CACHE });
  } catch {
    logSecurityEvent({ eventType: "game_session.leader_verification.failed", route: "/api/game-sessions/leader-verification", requestId, reason: "database_operation_failed", status: 500 });
    return NextResponse.json({ message: "Verification unavailable." }, { status: 500, headers: CACHE });
  }
}

export async function POST(request: Request) {
  const requestId = createSecurityRequestId();
  try {
    if (!sameOrigin(request)) return NextResponse.json({ message: "Verification unavailable." }, { status: 403, headers: CACHE });
    const body = await readOfficialSessionJson(request);
    const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
    const sessionId = record && Object.keys(record).length === 2 && typeof record.sessionId === "string" && OFFICIAL_SESSION_UUID.test(record.sessionId) ? record.sessionId : null;
    const token = record?.turnstileToken;
    const retry = record?.retry === true;
    if (!record || !(retry ? Object.hasOwn(record, "retry") : Object.hasOwn(record, "turnstileToken"))) {
      return NextResponse.json({ message: "Invalid verification request." }, { status: 400, headers: CACHE });
    }
    const playerId = await currentUserId();
    if (!sessionId || !playerId || !isAdminConfigured()) return NextResponse.json({ message: "Verification unavailable." }, { status: 404, headers: CACHE });
    const verification = await readVerification(sessionId, playerId);
    if (!verification) return NextResponse.json({ message: "Verification unavailable." }, { status: 409, headers: CACHE });
    if (retry) {
      if (verification.status !== "expired") return NextResponse.json({ message: "Verification unavailable." }, { status: 409, headers: CACHE });
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("rtw_begin_weekly_leader_human_verification", { p_session_id: sessionId, p_player_id: playerId });
      if (error) throw error;
      const renewed = data?.[0] as VerificationRow | undefined;
      const widget = renewed?.required && renewed.status === "pending" && renewed.widget_required
        ? getTurnstileWidgetConfiguration("weekly_leader_verification") : null;
      return NextResponse.json({ required: renewed?.required === true, status: renewed?.status ?? "expired", expiresAt: renewed?.expires_at ?? null, turnstileSiteKey: widget?.siteKey ?? null }, { headers: CACHE });
    }
    if (verification.status !== "pending") return NextResponse.json({ message: "Verification unavailable." }, { status: 409, headers: CACHE });
    const result = await verifyTurnstileToken(token, "weekly_leader_verification");
    if (result.status !== "verified") {
      const status = result.status === "unavailable" ? 503 : 400;
      logSecurityEvent({ eventType: "game_session.leader_verification.rejected", route: "/api/game-sessions/leader-verification", requestId, reason: result.status === "unavailable" ? "turnstile_provider_unavailable" : "turnstile_provider_rejected", status });
      return NextResponse.json({ message: result.status === "unavailable" ? "Verification is temporarily unavailable. Your result remains pending." : "Verification was not accepted. Try again with a new challenge." }, { status, headers: CACHE });
    }
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("rtw_verify_weekly_leader_human_verification", { p_session_id: sessionId, p_player_id: playerId });
    if (error) {
      if (error.code === "23514" || error.code === "P0002") return NextResponse.json({ message: "Verification unavailable." }, { status: 409, headers: CACHE });
      throw error;
    }
    return NextResponse.json({ verified: data === "verified", status: data === "verified" ? "verified" : "recorded_for_review" }, { headers: CACHE });
  } catch {
    logSecurityEvent({ eventType: "game_session.leader_verification.failed", route: "/api/game-sessions/leader-verification", requestId, reason: "database_operation_failed", status: 500 });
    return NextResponse.json({ message: "Verification unavailable." }, { status: 500, headers: CACHE });
  }
}
