import type { LaneInputEvent } from "./types";

export const OFFICIAL_SESSION_BODY_LIMIT_BYTES = 64 * 1024;
export const OFFICIAL_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The same strict event encoding is used by checkpoints and finalization.
 * Timing remains merely candidate evidence: the server replay applies its own
 * clock cap derived from the authoritative session start time.
 */
export function parseOfficialInputs(value: unknown, maxInputs: number): LaneInputEvent[] | null {
  if (!Array.isArray(value) || value.length > maxInputs) return null;
  const inputs: LaneInputEvent[] = [];
  let previousAtMs = -1;
  for (let index = 0; index < value.length; index += 1) {
    const input = value[index];
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const candidate = input as Record<string, unknown>;
    if (
      Object.keys(candidate).length !== 3 ||
      candidate.sequence !== index ||
      !Number.isSafeInteger(candidate.atMs) ||
      (candidate.atMs as number) < previousAtMs ||
      (candidate.atMs as number) < 0 ||
      (candidate.direction !== -1 && candidate.direction !== 1)
    ) return null;
    inputs.push({
      sequence: index,
      atMs: candidate.atMs as number,
      direction: candidate.direction as -1 | 1,
    });
    previousAtMs = candidate.atMs as number;
  }
  return inputs;
}

/** Bounded streamed JSON parsing; Content-Length is never trusted alone. */
export async function readOfficialSessionJson(request: Request): Promise<unknown | null> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > OFFICIAL_SESSION_BODY_LIMIT_BYTES)
  ) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > OFFICIAL_SESSION_BODY_LIMIT_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  try {
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
