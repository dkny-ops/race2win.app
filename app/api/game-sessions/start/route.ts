import { NextResponse } from "next/server";
import { GAMEPLAY_VERSION } from "@/lib/game/race-to-win";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
const CACHE = { "Cache-Control": "no-store" };
const SESSION_DURATION_MS = 10 * 60 * 1000;
const STARTS_PER_MINUTE = 8;

function seedFromServer(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

async function verifiedUserId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return typeof data?.claims?.sub === "string" ? data.claims.sub : null;
}

export async function POST() {
  try {
    const userId = await verifiedUserId();
    if (!userId) return NextResponse.json({ message: "Sign in to start an official session." }, { status: 401, headers: CACHE });
    if (!isAdminConfigured()) return NextResponse.json({ message: "Official sessions are unavailable." }, { status: 503, headers: CACHE });

    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const { count, error: countError } = await admin
      .from("game_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", cutoff);
    if (countError) throw countError;
    if ((count ?? 0) >= STARTS_PER_MINUTE) return NextResponse.json({ message: "Please wait before starting another session." }, { status: 429, headers: CACHE });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    const id = crypto.randomUUID();
    const { data, error } = await admin
      .from("game_sessions")
      .insert({ id, user_id: userId, game_id: "race-to-win", gameplay_version: GAMEPLAY_VERSION, seed: seedFromServer(), started_at: now.toISOString(), expires_at: expiresAt.toISOString() })
      .select("id, game_id, gameplay_version, seed, expires_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ sessionId: data.id, gameId: data.game_id, gameplayVersion: data.gameplay_version, seed: data.seed, expiresAt: data.expires_at }, { headers: CACHE });
  } catch {
    return NextResponse.json({ message: "Official sessions are unavailable." }, { status: 503, headers: CACHE });
  }
}
