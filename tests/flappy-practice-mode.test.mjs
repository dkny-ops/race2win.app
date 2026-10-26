import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../components/game/flappy-verified-canvas.tsx", import.meta.url), "utf8");

test("FlappyRace practice is independent from the Race To Win guest-trial marker", () => {
  assert.doesNotMatch(component, /@\/lib\/game\/guest-trial/);
  assert.doesNotMatch(component, /SIGN IN TO PLAY/);
  assert.equal((component.match(/>PLAY AGAIN<\/button>/g) ?? []).length, 1);
  assert.match(component, /Practice mode\. Scores do not count toward the ranking or prizes\./);
  assert.match(component, /FLAPPY_COMPETITION_ENABLED/);
});
