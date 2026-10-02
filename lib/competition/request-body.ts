import "server-only";

export const COMPETITION_MUTATION_BODY_LIMIT_BYTES = 2 * 1024;

function declaredBodyLengthIsAllowed(request: Request, limit: number): boolean {
  const rawLength = request.headers.get("content-length");
  if (rawLength === null) return true;
  if (!/^\d+$/.test(rawLength)) return false;
  const parsedLength = Number(rawLength);
  return Number.isSafeInteger(parsedLength) && parsedLength <= limit;
}

/**
 * Streams a small JSON mutation body instead of trusting Content-Length or
 * using request.json(), which would buffer an arbitrary chunked request.
 */
export async function readBoundedJson(request: Request, limit = COMPETITION_MUTATION_BODY_LIMIT_BYTES): Promise<unknown | null> {
  if (!declaredBodyLengthIsAllowed(request, limit) || !request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
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
    const body = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}

/** Balance claims deliberately accept no body; still drain and cap it. */
export async function hasEmptyBoundedBody(request: Request, limit = COMPETITION_MUTATION_BODY_LIMIT_BYTES): Promise<boolean> {
  if (!declaredBodyLengthIsAllowed(request, limit)) return false;
  if (!request.body) {
    const declaredLength = request.headers.get("content-length");
    return declaredLength === null || declaredLength === "0";
  }

  const reader = request.body.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return received === 0;
      received += value.byteLength;
      if (received > limit || received > 0) {
        await reader.cancel();
        return false;
      }
    }
  } catch {
    return false;
  } finally {
    reader.releaseLock();
  }
}
