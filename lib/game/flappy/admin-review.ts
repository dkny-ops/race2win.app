import "server-only";
import { createHash } from "node:crypto";
import { replayFlappy } from "./engine";

export type FlappyAuditRow = {
  session_id: string; player_id: string; username: string | null; created_at: string;
  status: string; version: string; tick: number; digest: string | null; input_count: number;
  score: number | null; collision_tick: number | null; completed_at: string | null;
  tournament_day: string | null; tournament_week_start: string | null;
  verification: string | null; eligibility: string | null;
  reviewed_at: string | null; review_note: string | null; reward_reserved: boolean;
};
type EvidenceRow = FlappyAuditRow & { seed: number | null; inputs: number[] | null };
export function summarizeFlappyAudit(row: EvidenceRow) {
  // Seed and inputs stay on the server, including for an authorized admin.
  const { seed, inputs, ...summary } = row;
  let replayMatches: boolean | null = null;
  if (row.status === "finalized" && seed !== null && inputs !== null) {
    try {
      const state = replayFlappy(Number(seed), inputs, row.tick);
      const digest = createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
      replayMatches = row.version === "flappy-v1" && !!state && state.dead && state.tick === row.tick && state.tick === row.collision_tick && state.score === row.score && digest === row.digest;
    } catch { replayMatches = false; }
  }
  return { ...summary, replayMatches, humanVerification: "not_established" as const };
}
