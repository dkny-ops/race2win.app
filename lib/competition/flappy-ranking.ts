import "server-only";
import { currentNewYorkTournamentWeek, readLeaderboard } from "@/lib/competition/scores";
import { createAdminClient } from "@/lib/supabase/admin";

export const FLAPPY_GAME_SLUG = "flappy-race";
// Enabling official play requires a reviewed authoritative validator, not a flag.
export const FLAPPY_OFFICIAL_ENABLED = false;
export type FlappyRanking = {
  game: "flappy-race"; tournamentWeek: string; page: number; hasNextPage: boolean;
  officialEnabled: false;
  entries: { rank: number | null; username: string; weeklyTotal: number; reviewRequired: boolean }[];
};
export function parseFlappyPage(params: URLSearchParams): number | null {
  if ([...params.keys()].some(key => key !== "page") || params.getAll("page").length > 1) return null;
  const raw = params.get("page") ?? "1";
  if (!/^[1-9]\d{0,2}$/.test(raw)) return null;
  const page = Number(raw);
  return page <= 100 ? page : null;
}
export async function readFlappyRanking(page: number): Promise<FlappyRanking> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100) throw new Error("Invalid page");
  const week = currentNewYorkTournamentWeek();
  const base: FlappyRanking = {
    game: FLAPPY_GAME_SLUG, tournamentWeek: week, page, hasNextPage: false,
    officialEnabled: FLAPPY_OFFICIAL_ENABLED, entries: [],
  };
  const admin = createAdminClient();
  const { data: game, error: gameError } = await admin.from("games")
    .select("id").eq("slug", FLAPPY_GAME_SLUG).eq("status", "active").maybeSingle();
  if (gameError) throw gameError;
  // Reads never register or activate a game.
  if (!game) return base;
  const board = await readLeaderboard({ gameSlug: FLAPPY_GAME_SLUG, week, page, pageSize: 50 });
  if (!board.entries.length) return { ...base, hasNextPage: board.hasNextPage };
  // Public usernames come only from the existing restricted reader. Profiles
  // include private payout data and must never be read by this feature.
  const ranks = board.entries.map(entry => entry.rank);
  const { data: totals, error: totalsError } = await admin.from("weekly_tournament_totals")
    .select("rank_position, weekly_total_score, tie_break_status")
    .eq("game_id", game.id).eq("tournament_week_start", week)
    .in("rank_position", ranks);
  if (totalsError) throw totalsError;
  const byRank = new Map<number, { total: number; review: boolean }>();
  for (const row of totals ?? []) {
    const total = Number(row.weekly_total_score);
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(row.rank_position) ||
        (row.tie_break_status !== "resolved" && row.tie_break_status !== "exact_tie") ||
        byRank.has(row.rank_position)) throw new Error("Invalid ranking metadata");
    byRank.set(row.rank_position, { total, review: row.tie_break_status === "exact_tie" });
  }
  return { ...base, hasNextPage: board.hasNextPage, entries: board.entries.map(entry => {
    const metadata = byRank.get(entry.rank);
    if (!metadata || metadata.total !== entry.weeklyTotal ||
        typeof entry.username !== "string" || !entry.username.trim()) throw new Error("Ranking snapshot changed");
    // Never expose the materializer's internal ordering of exact ties as a winner.
    return { rank: metadata.review ? null : entry.rank, username: entry.username,
      weeklyTotal: metadata.total, reviewRequired: metadata.review };
  }) };
}
