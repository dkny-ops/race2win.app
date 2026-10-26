import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const component = await readFile(new URL("../components/game/flappy-verified-canvas.tsx", import.meta.url), "utf8");
test("public FlappyRace starts only official sessions without a mode selector or browser mode input", () => {
  assert.doesNotMatch(component, /<select|setMode|useSearchParams|location\.search|getRandomValues/);
  assert.match(component, /const session = await startFlappyOfficial\(\)/);
  assert.match(component, /disabled=\{blocked/);
  assert.match(component, /FLAPPY_COMPETITION_ENABLED/);
});
