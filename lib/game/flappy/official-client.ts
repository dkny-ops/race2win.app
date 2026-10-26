"use client";
import { FLAPPY_VERSION, type FlappyState, MAX_INPUTS } from "./engine";
export type FlappySession = { sessionId: string; seed: number; version: string; startsAt: string; serverNow: string; expiresAt: string };
export type FlappyResult = { score: number; collisionTick: number; eligibility: "under_review"; verification: "replay_verified" };
export class FlappyOfficialError extends Error {
 constructor(public code: string) { super("Official FlappyRace request unavailable."); }
}
async function post(action: string, body: unknown) {
  const response = await fetch(`/api/flappy-race/sessions/${action}`, {
    signal: AbortSignal.timeout(10_000),
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    let code = "service_unavailable";
    try { const error = await response.json(); if (["unauthenticated","terms_required","review_required","rate_limited","start_rejected"].includes(error.code)) code = error.code; } catch {}
    throw new FlappyOfficialError(code);
  }
  return response.json();
}
export async function startFlappyOfficial(): Promise<FlappySession> {
  const session = await post("start", {}) as FlappySession;
  if (session.version !== FLAPPY_VERSION || !Number.isInteger(session.seed) ||
      !Number.isFinite(Date.parse(session.startsAt)) || !Number.isFinite(Date.parse(session.serverNow)) || Date.parse(session.startsAt) <= Date.parse(session.serverNow) || !Number.isFinite(Date.parse(session.expiresAt))) throw new Error("Invalid official session");
  return session;
}
export async function checkpointFlappyOfficial(session: FlappySession, state: FlappyState, inputs: number[]): Promise<void> {
  if (inputs.length > MAX_INPUTS) throw new Error("Input limit");
  await post("checkpoint", { sessionId: session.sessionId, throughTick: state.tick, inputs });
}
export async function finalizeFlappyOfficial(session: FlappySession, state: FlappyState, inputs: number[]): Promise<FlappyResult> {
  const result = await post("finalize", { sessionId: session.sessionId, throughTick: state.tick, inputs }) as FlappyResult;
  if (result.verification !== "replay_verified" || result.eligibility !== "under_review" ||
      !Number.isSafeInteger(result.score) || result.score < 0) throw new Error("Invalid official outcome");
  return result;
}
