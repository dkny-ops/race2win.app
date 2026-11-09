import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../components/game/flappy-verified-canvas.tsx", import.meta.url), "utf8");

test("guest Flappy runs locally without opening official sessions or writing scores", () => {
  assert.match(component, /const session = authenticated \? await startFlappyOfficial\(\) : null/);
  assert.match(component, /official\.current = session/);
  assert.match(component, /if \(session\) beginVerification\(session\.sessionId, session\.turnstile\)/);
  assert.match(component, /if \(official\.current\) \{/);
  assert.match(component, /else setStatus\("over"\)/);
  assert.match(component, /else if \(official\.current && g\.tick >= nextCheckpoint\.current/);
  assert.match(component, /authenticated && \(!FLAPPY_COMPETITION_ENABLED/);
  assert.match(component, /disabled=\{blocked/);
  assert.doesNotMatch(component, /<select|setMode|useSearchParams|location\.search|getRandomValues/);
});
