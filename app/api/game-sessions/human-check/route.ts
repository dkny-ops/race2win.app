import { replayAuthoritativeProgress } from "@/lib/game/race-to-win/authoritative-replay";
import { parseOfficialInputs } from "@/lib/game/race-to-win/official-inputs";
import { randomInt } from "node:crypto";
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
  if (![3, 6].includes(Object.keys(b).length) || !validId(b.sessionId) || !validId(b.nonce) || !Number.isInteger(b.choice) || (b.choice as number) < 0 || (b.choice as number) > 3 || (Object.keys(b).length === 6 && (typeof b.turnstileToken !== "string" || !Number.isSafeInteger(b.resumeMs) || (b.resumeMs as number) < 0 || !Array.isArray(b.inputs))) || (Object.keys(b).length === 3 && "turnstileToken" in b)) return NextResponse.json({ message: "Invalid" }, { status: 400, headers: HEADERS });
  const user = await getVerifiedUserContext();
  if (!user || !isAdminConfigured()) return NextResponse.json({ message: "Unavailable" }, { status: 401, headers: HEADERS });
  if (!("turnstileToken" in b)) {
   const { data: accepted, error: choiceError } = await createAdminClient().rpc("rtw_record_human_check_choice", { p_session_id: b.sessionId, p_player_id: user.userId, p_nonce: b.nonce, p_choice: b.choice });
   return NextResponse.json({ accepted: !choiceError && accepted === true }, { status: !choiceError && accepted === true ? 200 : 409, headers: HEADERS });
  }
  const check = await readCheck(b.sessionId, user.userId);
  if (!check || check.status !== "pending" || check.nonce !== b.nonce || check.target !== b.choice || Date.parse(check.due_at) > Date.now()) return NextResponse.json({ message: "Verification failed" }, { status: 409, headers: HEADERS });
  const inputs = parseOfficialInputs(b.inputs, 4096);
  if (!inputs) return NextResponse.json({ message: "Invalid inputs" }, { status: 400, headers: HEADERS });
  const admin = createAdminClient();
  const { data: session } = await admin.from("game_sessions").select("seed,gameplay_version,started_at,status").eq("id",b.sessionId).eq("user_id",user.userId).maybeSingle();
  if (!session || session.status !== "active" || (b.resumeMs as number) > Date.now()-Date.parse(session.started_at)+1000) return NextResponse.json({ message: "Invalid resume" }, { status: 409, headers: HEADERS });
  const { data: prior, error: priorError } = await admin.rpc("rtw_read_verified_protections",{p_session_id:b.sessionId,p_player_id:user.userId});
  if (priorError) throw priorError;
  const protections = (prior ?? []).map((x:{resume_simulation_ms:number})=>x.resume_simulation_ms);
  const progress = replayAuthoritativeProgress(session.gameplay_version,Number(session.seed),inputs,b.resumeMs as number,protections);
  if (!progress || progress.state !== "running" || Math.abs(progress.elapsedMs - (b.resumeMs as number)) > 20) return NextResponse.json({ message: "Invalid replay" }, { status: 409, headers: HEADERS });
  const verified = await verifyTurnstileToken(b.turnstileToken, "midrun_human_check");
  if (verified.status !== "verified") {
   // Only log a bounded reason category; never log challenge answers, tokens, or player identifiers.
   console.warn("midrun_turnstile_verification", { status: verified.status, reason: verified.reason });
   return NextResponse.json({ message: verified.status === "unavailable" ? "Verification temporarily unavailable" : "Human verification failed", code: verified.status === "unavailable" ? "verification_unavailable" : "verification_rejected" }, { status: verified.status === "unavailable" ? 503 : 403, headers: HEADERS });
  }
  const { data, error } = await createAdminClient().rpc("rtw_verify_and_advance_human_check", { p_session_id: b.sessionId, p_player_id: user.userId, p_nonce: b.nonce, p_choice: b.choice, p_next_target: randomInt(0, 4) });
  if (error || data !== true) return NextResponse.json({ message: "Verification pending" }, { status: 409, headers: HEADERS });
  const {data:recorded,error:recordError}=await admin.rpc("rtw_record_verified_protection",{p_session_id:b.sessionId,p_player_id:user.userId,p_nonce:b.nonce,p_resume_ms:b.resumeMs});
  if(recordError || recorded!==true) return NextResponse.json({message:"Protection recording failed"},{status:503,headers:HEADERS});
  return NextResponse.json({ verified: true, protected: true }, { headers: HEADERS });
 } catch { return NextResponse.json({ message: "Verification unavailable" }, { status: 503, headers: HEADERS }); }
}