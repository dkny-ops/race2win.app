import "server-only";

import { currentNewYorkTournamentWeek, type ScoreWeek } from "@/lib/competition/scores";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DAILY_SCORE = 500;
const MAX_WEEKLY_SCORE = MAX_DAILY_SCORE * 7 * 7;

export type FlappyPersonalWeek = Readonly<{
  game: "flappy-race";
  tournamentWeek: ScoreWeek;
  weeklyTotal: number;
  days: readonly Readonly<{ day: string; topScores: readonly number[]; dailyTotal: number }>[];
}>;

function expectedDays(week: ScoreWeek): string[] {
  const start = new Date(`${week}T12:00:00.000Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function isScore(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_DAILY_SCORE;
}

function parsePersonalWeek(raw: unknown, week: ScoreWeek): FlappyPersonalWeek {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid personal score metadata");
  const result = raw as { week?: unknown; weeklyTotal?: unknown; days?: unknown };
  if (result.week !== week || !Number.isSafeInteger(result.weeklyTotal) || Number(result.weeklyTotal) < 0 || Number(result.weeklyTotal) > MAX_WEEKLY_SCORE || !Array.isArray(result.days) || result.days.length !== 7) {
    throw new Error("Invalid personal score metadata");
  }
  const weeklyTotal = Number(result.weeklyTotal);
  const expected = expectedDays(week);
  const days = result.days.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid daily score metadata");
    const day = row as { day?: unknown; topScores?: unknown; dailyTotal?: unknown };
    if (day.day !== expected[index] || !Array.isArray(day.topScores) || day.topScores.length > 7 || !Number.isSafeInteger(day.dailyTotal) || Number(day.dailyTotal) < 0 || Number(day.dailyTotal) > MAX_DAILY_SCORE * 7 || !day.topScores.every(isScore)) {
      throw new Error("Invalid daily score metadata");
    }
    const topScores = [...day.topScores] as number[];
    const dailyTotal = Number(day.dailyTotal);
    if (topScores.some((score, scoreIndex) => scoreIndex > 0 && score > topScores[scoreIndex - 1]) || topScores.reduce((sum, score) => sum + score, 0) !== dailyTotal) {
      throw new Error("Invalid daily score metadata");
    }
    return { day: day.day, topScores, dailyTotal };
  });

  if (days.reduce((sum, day) => sum + day.dailyTotal, 0) !== weeklyTotal) throw new Error("Invalid personal score metadata");
  return { game: "flappy-race", tournamentWeek: week, weeklyTotal, days };
}

/** Reads only verified, counting FlappyRace runs for the authenticated server-selected player. */
export async function readFlappyPersonalWeek(playerId: string): Promise<FlappyPersonalWeek> {
  if (!UUID.test(playerId)) throw new Error("Invalid player context");
  const week = currentNewYorkTournamentWeek();
  const { data, error } = await createAdminClient().rpc("flappy_read_personal_week", {
    p_player: playerId,
    p_week: week,
  });
  if (error) throw new Error("Personal score unavailable");
  return parsePersonalWeek(data, week);
}
