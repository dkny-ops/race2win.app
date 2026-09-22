import "server-only";

import { createHash } from "node:crypto";
import type { LaneInputEvent } from "./types";

/** New rtw-v7 sessions renew their server activity lease every 1,000 points. */
export const SCORE_CHECKPOINT_INTERVAL = 1_000;
export const LEGACY_SCORE_CHECKPOINT_INTERVAL = 5_000;
export const OFFICIAL_ACTIVITY_LEASE_SECONDS = 360;
export const OFFICIAL_CHECKPOINT_NETWORK_MARGIN_SECONDS = 45;

export type StoredCheckpointProof = Readonly<{
  checkpoint_index: number;
  milestone_score: number;
  proof_input_digest: string;
  proof_input_count: number;
}>;

export function isCheckpointInterval(value: unknown): value is number {
  return value === SCORE_CHECKPOINT_INTERVAL || value === LEGACY_SCORE_CHECKPOINT_INTERVAL;
}

export function checkpointCountForScore(score: number, interval = SCORE_CHECKPOINT_INTERVAL): number {
  return Number.isSafeInteger(score) && score >= 0 && isCheckpointInterval(interval)
    ? Math.floor(score / interval)
    : -1;
}

export function digestOfficialInputs(inputs: readonly LaneInputEvent[]): string {
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

/**
 * A later replay can only extend a checkpoint proof; it cannot rewrite the
 * exact input prefix recorded at an earlier accepted milestone.
 */
export function proofMatchesInputs(
  proof: StoredCheckpointProof,
  inputs: readonly LaneInputEvent[],
  interval = SCORE_CHECKPOINT_INTERVAL,
): boolean {
  return Number.isSafeInteger(proof.checkpoint_index) &&
    proof.checkpoint_index > 0 &&
    isCheckpointInterval(interval) &&
    proof.milestone_score === proof.checkpoint_index * interval &&
    Number.isSafeInteger(proof.proof_input_count) &&
    proof.proof_input_count >= 0 &&
    proof.proof_input_count <= inputs.length &&
    /^[a-f0-9]{64}$/.test(proof.proof_input_digest) &&
    digestOfficialInputs(inputs.slice(0, proof.proof_input_count)) === proof.proof_input_digest;
}
