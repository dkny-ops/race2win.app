import "server-only";

import { RACE_TO_WIN_GAME_SLUG } from "@/lib/routes";
import { createAdminClient } from "@/lib/supabase/admin";

const WEEK = /^\d{4}-\d{2}-\d{2}$/;
const GAME_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ScoreWeek = `${number}-${number}-${number}`;

export function currentNewYorkTournamentWeek(now = new Date()): ScoreWeek {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(byType.get("year"));
  const month = Number(byType.get("month"));
  const day = Number(byType.get("day"));
  const weekday = byType.get("weekday");
  const offset = ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as const)[weekday as "Mon"];
  const utcDate = new Date(Date.UTC(year, month - 1, day - offset));
  return utcDate.toISOString().slice(0, 10) as ScoreWeek;
}

export function parseLeaderboardRequest(searchParams: URLSearchParams): {
  gameSlug: string;
  week: ScoreWeek;
  page: number;
  pageSize: number;
} | null {
  const gameSlug = searchParams.get("game") ?? RACE_TO_WIN_GAME_SLUG;
  const requestedWeek = searchParams.get("week") ?? currentNewYorkTournamentWeek();
  const rawPage = searchParams.get("page") ?? "1";
  const rawPageSize = searchParams.get("pageSize") ?? "50";
  if (!GAME_SLUG.test(gameSlug) || !WEEK.test(requestedWeek) || !/^\d+$/.test(rawPage) || !/^\d+$/.test(rawPageSize)) return null;
  const parsedWeek = new Date(`${requestedWeek}T00:00:00.000Z`);
  if (Number.isNaN(parsedWeek.valueOf()) || parsedWeek.getUTCDay() !== 1) return null;
  const page = Number(rawPage);
  const pageSize = Number(rawPageSize);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) return null;
  return { gameSlug, week: requestedWeek as ScoreWeek, page, pageSize };
}

async function gameForSlug(slug: string): Promise<{ id: string; slug: string; display_name: string } | null> {
  const { data, error } = await createAdminClient()
    .from("games")
    .select("id, slug, display_name")
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type PersonalScoresResponse = Readonly<{
  tournamentWeek: ScoreWeek;
  game: { slug: string; name: string };
  weeklyTotal: number;
  rank: number | null;
  pendingRuns: readonly { sessionId: string; score: number; tournamentDay: string }[];
  dailyTop7: readonly { day: string; rank: number; score: number; elapsedMs: number | null }[];
  recentValidatedRuns: readonly { score: number; distanceMillimeters: number; elapsedMs: number; completedAt: string; tournamentDay: string }[];
}>;

export async function readPersonalScores(playerId: string): Promise<PersonalScoresResponse> {
  const game = await gameForSlug(RACE_TO_WIN_GAME_SLUG);
  if (!game) throw new Error("Race To Win is unavailable.");
  const tournamentWeek = currentNewYorkTournamentWeek();
  const admin = createAdminClient();
  const [totalResult, dailyResult, recentResult, pendingResult] = await Promise.all([
    admin.from("weekly_tournament_totals")
      .select("weekly_total_score, rank_position")
      .eq("game_id", game.id)
      .eq("player_id", playerId)
      .eq("tournament_week_start", tournamentWeek)
      .maybeSingle(),
    admin.from("daily_top_scores")
      .select("tournament_day, daily_rank, score, validated_run_id")
      .eq("game_id", game.id)
      .eq("player_id", playerId)
      .eq("tournament_week_start", tournamentWeek)
      .order("tournament_day", { ascending: true })
      .order("daily_rank", { ascending: true }),
    admin.from("validated_runs")
      .select("score, distance_millimeters, elapsed_ms, completed_at, tournament_day")
      .eq("game_id", game.id)
      .eq("player_id", playerId)
      .eq("eligibility_status", "valid")
      .order("completed_at", { ascending: false })
      .limit(10),
    admin.from("validated_runs")
      .select("game_session_id, score, tournament_day")
      .eq("game_id", game.id)
      .eq("player_id", playerId)
      .eq("tournament_week_start", tournamentWeek)
      .eq("eligibility_status", "under_review")
      .order("completed_at", { ascending: false })
      .limit(50),
  ]);
  if (totalResult.error) throw totalResult.error;
  if (dailyResult.error) throw dailyResult.error;
  if (recentResult.error) throw recentResult.error;
  if (pendingResult.error) throw pendingResult.error;
  const topRunIds = (dailyResult.data ?? []).map(row => row.validated_run_id).filter((id): id is string => typeof id === "string");
  const durations = new Map<string, number>();
  if (topRunIds.length) {
    const { data: runTimes, error: timesError } = await admin.from("validated_runs")
      .select("id, elapsed_ms")
      .eq("player_id", playerId)
      .eq("game_id", game.id)
      .eq("eligibility_status", "valid")
      .in("id", topRunIds);
    if (timesError) throw timesError;
    for (const run of runTimes ?? []) durations.set(run.id, Number(run.elapsed_ms));
  }
  return {
    tournamentWeek,
    game: { slug: game.slug, name: game.display_name },
    weeklyTotal: Number(totalResult.data?.weekly_total_score ?? 0),
    rank: totalResult.data?.rank_position ?? null,
    pendingRuns: (pendingResult.data ?? []).map((row) => ({ sessionId: row.game_session_id, score: row.score, tournamentDay: row.tournament_day })),
    dailyTop7: (dailyResult.data ?? []).map((row) => ({
      day: row.tournament_day,
      rank: row.daily_rank,
      score: row.score,
      elapsedMs: durations.get(row.validated_run_id) ?? null,
    })),
    recentValidatedRuns: (recentResult.data ?? []).map((row) => ({
      score: row.score,
      distanceMillimeters: Number(row.distance_millimeters),
      elapsedMs: row.elapsed_ms,
      completedAt: row.completed_at,
      tournamentDay: row.tournament_day,
    })),
  };
}

export type LeaderboardResponse = Readonly<{
  game: { slug: string; name: string };
  tournamentWeek: ScoreWeek;
  page: number;
  pageSize: number;
  entries: readonly { rank: number; username: string; weeklyTotal: number }[];
  hasNextPage: boolean;
}>;

export async function readLeaderboard(params: NonNullable<ReturnType<typeof parseLeaderboardRequest>>): Promise<LeaderboardResponse> {
  const game = await gameForSlug(params.gameSlug);
  if (!game) throw new Error("Game unavailable.");
  const admin = createAdminClient();
  // Profiles include private payout data and deliberately deny service-role
  // table reads. This existing restricted RPC exposes only public ranked rows
  // and counts public entries before pagination, including empty pages.
  const { data, error } = await admin.rpc("rtw_read_public_leaderboard_page_metadata", {
    p_game_id: game.id,
    p_tournament_week_start: params.week,
    p_page: params.page,
    p_page_size: params.pageSize,
  });
  if (error) throw error;
  const board = data as { total_public_entries: number; entries: { rank_position: number; username: string; weekly_total_score: number | string }[] } | null;
  if (!board || !Array.isArray(board.entries) || !Number.isSafeInteger(Number(board.total_public_entries))) {
    throw new Error("Invalid public leaderboard response.");
  }
  return {
    game: { slug: game.slug, name: game.display_name },
    tournamentWeek: params.week,
    page: params.page,
    pageSize: params.pageSize,
    entries: board.entries.map((row) => ({ rank: row.rank_position, username: row.username, weeklyTotal: Number(row.weekly_total_score) })),
    hasNextPage: Number(board.total_public_entries) > params.page * params.pageSize && params.page < 100,
  };
}
