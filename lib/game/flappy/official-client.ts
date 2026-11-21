"use client";
import { FLAPPY_VERSION, type FlappyState, MAX_INPUTS } from "./engine";
import { parseFlappyAvailability, type FlappyAvailability } from "./availability";
import type { FlappyCheckConfiguration } from "./invisible-verification";
export type FlappySession = { sessionId: string; seed: number; version: string; startsAt: string; serverNow: string; expiresAt: string; turnstile?: FlappyCheckConfiguration };
export type FlappyPreflight = { nonce: string; expiresAt: string; siteKey: string };
export type FlappyResult = { score: number; collisionTick: number; eligibility: "valid" | "under_review"; verification: "replay_verified" };
export class FlappyOfficialError extends Error {
 constructor(public code: string) { super("Official FlappyRace request unavailable."); }
}
async function request(url: string, body?: unknown) {
  let response: Response;
  try { response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }); } catch { throw new FlappyOfficialError("connection_error"); }
  if (!response.ok) {
    let code = "service_unavailable";
    try { const error = await response.json(); if (["verified_email_required","identity_conflict","unauthenticated","terms_required","review_required","rate_limited","start_rejected","verification_unavailable","attempts_exhausted","session_active","FLAPPY_OFFICIAL_DISABLED","evidence_conflict","checkpoint_conflict","replay_rejected","finalize_conflict","future_input","expired"].includes(error.code)) code = error.code; } catch {}
    throw new FlappyOfficialError(code);
  }
  return response.json();
}
function post(action: string, body: unknown) { return request(`/api/flappy-race/sessions/${action}`, body); }
export async function readFlappyAvailability(): Promise<FlappyAvailability> {
  return parseFlappyAvailability(await request("/api/flappy-race/opportunities"));
}
export async function prepareFlappyOfficial(): Promise<FlappyPreflight> {
  const preflight = await post("preflight", {}) as FlappyPreflight;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(preflight.nonce) ||
      typeof preflight.siteKey !== "string" || !preflight.siteKey || !Number.isFinite(Date.parse(preflight.expiresAt))) throw new Error("Invalid verification configuration");
  return preflight;
}
export async function startFlappyOfficial(token: string, nonce: string): Promise<FlappySession> {
  const session = await post("start", { token, nonce }) as FlappySession;
  if (session.version !== FLAPPY_VERSION || !Number.isInteger(session.seed) ||
      !Number.isFinite(Date.parse(session.startsAt)) || !Number.isFinite(Date.parse(session.serverNow)) || Date.parse(session.startsAt) <= Date.parse(session.serverNow) || !Number.isFinite(Date.parse(session.expiresAt))) throw new Error("Invalid official session");
  if (session.turnstile && (session.turnstile.required !== true || typeof session.turnstile.siteKey !== "string" ||
      !session.turnstile.siteKey || !Number.isFinite(Date.parse(session.turnstile.serverNow)) || !Number.isFinite(Date.parse(session.turnstile.nextDueAt!)))) throw new Error("Invalid verification configuration");
  return session;
}
export async function checkpointFlappyOfficial(session: FlappySession, state: FlappyState, inputs: number[]): Promise<void> {
  if (inputs.length > MAX_INPUTS) throw new Error("Input limit");
  await post("checkpoint", { sessionId: session.sessionId, throughTick: state.tick, inputs });
}
export async function finalizeFlappyOfficial(session: FlappySession, state: FlappyState, inputs: number[]): Promise<FlappyResult> {
  const result = await post("finalize", { sessionId: session.sessionId, throughTick: state.tick, inputs }) as FlappyResult;
  if (result.verification !== "replay_verified" || !["valid", "under_review"].includes(result.eligibility) ||
      !Number.isSafeInteger(result.score) || result.score < 0) throw new Error("Invalid official outcome");
  return result;
}
