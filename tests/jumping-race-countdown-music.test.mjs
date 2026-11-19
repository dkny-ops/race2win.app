import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const component = path.join(root, "components", "game", "jumping-race-game.tsx");

test("Jumping Race starts its supplied soundtrack only with the game countdown", () => {
  const source = fs.readFileSync(component, "utf8");
  const music = path.join(root, "public", "audio", "jumping-race-race.mp3");

  assert.ok(fs.statSync(music).size > 0, "the approved music asset must ship with the game");
  assert.match(source, /new Audio\("\/audio\/jumping-race-race\.mp3"\)/);
  assert.match(source, /soundtrack\.volume = 0/);
  assert.match(source, /setCountdown\(3\)/);
  assert.match(source, /setCountdown\(2\).*1000/s);
  assert.match(source, /setCountdown\(1\).*2000/s);
  assert.match(source, /soundtrack\.volume = musicIsAllowed\(\) \? 0\.35 : 0/);
  assert.match(source, /state\.started = true/);
  assert.match(source, /soundtrack\?\.pause\(\)/);
});

test("Jumping Race hands off shared music only when PLAY starts and releases it on navigation", () => {
  const game = fs.readFileSync(component, "utf8");
  const coordinator = fs.readFileSync(path.join(root, "components", "layout", "site-audio.tsx"), "utf8");

  assert.match(game, /Keep website music on the pre-game screen/);
  assert.match(game, /const soundtrack = prepareMusic\(\);\s+\/\/ Keep website music[\s\S]*claimGameAudio\("jumping", soundtrack\)/);
  assert.match(game, /releaseGameAudio\("jumping", soundtrack\)/);
  assert.match(game, /GAME OVER returns the shared soundtrack to the website/);
  assert.match(game, /releaseGameAudio\("jumping", music\.current\)/);
  assert.match(game, /rtw-site-audio-state/);
  assert.match(game, /musicIsAllowed\(\)/);
  assert.match(coordinator, /GameAudioChannel/);
  assert.match(coordinator, /channel !== "site"/);
});
