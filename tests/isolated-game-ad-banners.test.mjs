import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const banner = fs.readFileSync("components/marketing/adsterra-game-banners.tsx", "utf8");
const home = fs.readFileSync("components/marketing/localized-home.tsx", "utf8");
const race = fs.readFileSync("app/games/race-to-win/page.tsx", "utf8");
const flappy = fs.readFileSync("components/game/flappy-race-page.tsx", "utf8");
const flappyCanvas = fs.readFileSync("components/game/flappy-verified-canvas.tsx", "utf8");
const jumping = fs.readFileSync("components/game/jumping-race-game.tsx", "utf8");

test("new game banners use the separate advertising origin and load one size at a time", () => {
  assert.match(banner, /https:\/\/ads\.racetowin\.app\/game-desktop/);
  assert.match(banner, /https:\/\/ads\.racetowin\.app\/game-mobile/);
  assert.match(banner, /sandbox="allow-scripts"/);
  assert.doesNotMatch(banner, /allow-same-origin/);
  assert.doesNotMatch(banner, /bauval\.org/);
  assert.match(banner, /matchMedia/);
});

test("new banners stay below the existing Home ads and only on each game's initial screen", () => {
  assert.ok(home.indexOf("<AdsterraGameBanners") > home.indexOf("<AdsterraHomeAds"));
  assert.match(race, /<AdsterraGameBanners className="rtw-game-ad"/);
  assert.match(flappy, /preGameBanner=\{<AdsterraGameBanners className="flappy-game-ad"/);
  assert.match(flappyCanvas, /!expanded && status === "ready" \? preGameBanner : null/);
  assert.match(jumping, /status === "ready" \? <AdsterraGameBanners className="jumping-game-ad"/);
});
