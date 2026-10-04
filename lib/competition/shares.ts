import "server-only";

import { currentNewYorkTournamentWeek, type ScoreWeek } from "@/lib/competition/scores";
import { RACE_TO_WIN_GAME_SLUG } from "@/lib/routes";
import { createAdminClient } from "@/lib/supabase/admin";

export type WeeklyShareLeaderboard = Readonly<{
  tournamentWeek: ScoreWeek;
  gameName: string;
  entries: readonly { rank: number; username: string; confirmedShares: number }[];
}>;

type ShareLeaderboardRow = Readonly<{
  rank_position: unknown;
  username: unknown;
  confirmed_share_count: unknown;
}>;

/** Reads a fixed, public projection produced from server-confirmed referrals. */
export async function readWeeklyShareLeaderboard(): Promise<WeeklyShareLeaderboard> {
  const admin = createAdminClient();
  const { data: game, error: gameError } = await admin
    .from("games")
    .select("id, display_name")
    .eq("slug", RACE_TO_WIN_GAME_SLUG)
    .eq("status", "active")
    .maybeSingle();
  if (gameError || !game) throw new Error("Share game is unavailable.");

  const tournamentWeek = currentNewYorkTournamentWeek();
  const { data, error } = await admin.rpc("rtw_read_weekly_share_leaderboard", {
    p_game_id: game.id,
    p_tournament_week_start: tournamentWeek,
    p_limit: 10,
  });
  if (error) throw error;

  const rows = (data ?? []) as readonly ShareLeaderboardRow[];
  const entries = rows.flatMap((row) => {
    if (
      typeof row.rank_position !== "number" || !Number.isSafeInteger(row.rank_position) || row.rank_position < 1
      || typeof row.username !== "string" || row.username.length < 1 || row.username.length > 40
      || typeof row.confirmed_share_count !== "number" || !Number.isSafeInteger(row.confirmed_share_count) || row.confirmed_share_count < 1
    ) return [];
    return [{ rank: row.rank_position, username: row.username, confirmedShares: row.confirmed_share_count }];
  });
  return { tournamentWeek, gameName: game.display_name, entries };
}
