import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const noStore = { "Cache-Control": "no-store" };
export function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: noStore }); }
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return (!origin || origin === new URL(request.url).origin) && request.headers.get("sec-fetch-site") !== "cross-site";
}
export async function player() {
  const context = await getVerifiedUserContext();
  return context?.userId ?? null;
}
export function admin() { return isAdminConfigured() ? createAdminClient() : null; }
export async function body(request: Request, max = 80_000): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > max) return null;
  const raw = await request.text();
  if (raw.length > max) return null;
  try { const parsed: unknown = JSON.parse(raw); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; } catch { return null; }
}
export function uuid(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v); }
export function digest(v: unknown): v is string { return typeof v === "string" && /^[a-f0-9]{64}$/.test(v); }
