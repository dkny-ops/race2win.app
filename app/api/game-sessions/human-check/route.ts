import { NextResponse } from "next/server";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { OFFICIAL_SESSION_UUID, readOfficialSessionJson } from "@/lib/game/race-to-win/official-inputs";
import { getTurnstileWidgetConfiguration, verifyTurnstileToken } from "@/lib/security/turnstile";
export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "no-store" };
type Check = { due_at: string; nonce: string; status: string; target: number | null };
function validId(value: unknown): value is string { return typeof value === "string" && OFFICIAL_SESSION_UUID.test(value); }
async function readCheck(id: string, userId: string): Promise<Check | null> {
 const { data, error } = await createAdminClient().rpc("rtw_read_human_check", { p_session_id: id, p_player_id: userId });
 if (error) throw error;
 return (Array.isArray(data) ? data[0] : null) as Check | null;
}
export async function GET(request: Request) {
 try {
  const id = new URL(request.url).searchParams.get("sessionId");
  const user = await getVerifiedUserContext();
  if (!validId(id) || !user || !isAdminConfigured()) return NextResponse.json({ message: "Unavailable" }, { status: 404, headers: HEADERS });
  const check = await readCheck(id, user.userId);
  if (!check) return NextResponse.json({ message: "Unavailable" }, { status: 404, headers: HEADERS });
  const due = Date.parse(check.due_at) <= Date.now();
  const widget = due && check.status === "pending" ? getTurnstileWidgetConfiguration("midrun_human_check") : null;
  return NextResponse.json({ due, verified: check.status === "verified", nonce: due ? check.nonce : null, target: due ? check.target : null, siteKey: widget?.siteKey ?? null }, { headers: HEADERS });
 } catch { return NextResponse.json({ message: "Unavailable" }, { status: 503, headers: HEADERS }); }
}
export async function POST(request: Request) {
 try {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: HEADERS });
  const body = await readOfficialSessionJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "Invalid" }, { status: 400, headers: HEADERS });
  const b = body as Record<string, unknown>;
  if (Object.keys(b).length !== 4 || !validId(b.sessionId) || !validId(b.nonce) || !Number.isInteger(b.choice) || (b.choice as number) < 0 || (b.choice as number) > 3 || typeof b.turnstileToken !== "string") return NextResponse.json({ message: "Invalid" }, { status: 400, headers: HEADERS });
  const user = await getVerifiedUserContext();
  if (!user || !isAdminConfigured()) return NextResponse.json({ message: "Unavailable" }, { status: 401, headers: HEADERS });
  const check = await readCheck(b.sessionId, user.userId);
  if (!check || check.status !== "pending" || check.nonce !== b.nonce || check.target !== b.choice || Date.parse(check.due_at) > Date.now()) return NextResponse.json({ message: "Verification failed" }, { status: 409, headers: HEADERS });
  const verified = await verifyTurnstileToken(b.turnstileToken, "midrun_human_check");
  if (verified.status !== "verified") return NextResponse.json({ message: "Verification pending" }, { status: verified.status === "unavailable" ? 503 : 400, headers: HEADERS });
  const { data, error } = await createAdminClient().rpc("rtw_verify_human_check", { p_session_id: b.sessionId, p_player_id: user.userId, p_nonce: b.nonce, p_choice: b.choice });
  if (error || data !== true) return NextResponse.json({ message: "Verification pending" }, { status: 409, headers: HEADERS });
  return NextResponse.json({ verified: true }, { headers: HEADERS });
 } catch { return NextResponse.json({ message: "Verification unavailable" }, { status: 503, headers: HEADERS }); }
}