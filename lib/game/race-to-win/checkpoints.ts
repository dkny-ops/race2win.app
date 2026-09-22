import "server-only";

import { createHash } from "node:crypto";
import type { LaneInputEvent } from "./types";

export const SCORE_CHECKPOINT_INTERVAL = 5_000;

export type StoredCheckpointProof = Readonly<{
  checkpoint_index: number;
  milestone_score: number;
  proof_input_digest: string;
  proof_input_count: number;
}>;

export function checkpointCountForScore(score: number): number {
  return Number.isSafeInteger(score) && score >= 0
    ? Math.floor(score / SCORE_CHECKPOINT_INTERVAL)
    : -1;
}

export function digestOfficialInputs(inputs: readonly LaneInputEvent[]): string {
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

/**
 * A later replay can only extend a checkpoint proof; it cannot rewrite the
 * exact input prefix recorded at an earlier accepted milestone.
 */
export function proofMatchesInputs(proof: StoredCheckpointProof, inputs: readonly LaneInputEvent[]): boolean {
  return Number.isSafeInteger(proof.checkpoint_index) &&
    proof.checkpoint_index > 0 &&
    proof.milestone_score === proof.checkpoint_index * SCORE_CHECKPOINT_INTERVAL &&
    Number.isSafeInteger(proof.proof_input_count) &&
    proof.proof_input_count >= 0 &&
    proof.proof_input_count <= inputs.length &&
    /^[a-f0-9]{64}$/.test(proof.proof_input_digest) &&
    digestOfficialInputs(inputs.slice(0, proof.proof_input_count)) === proof.proof_input_digest;
}
