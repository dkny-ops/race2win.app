import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const banner = fs.readFileSync("components/marketing/adsterra-game-banners.tsx", "utf8");
const home = fs.readFileSync("components/marketing/localized-home.tsx", "utf8");
const race = fs.readFileSync("app/games/race-to-win/page.tsx", "utf8");
const flappy = fs.readFileSync("components/game/flappy-race-page.tsx", "utf8");
const flappyCanvas = fs.readFileSync("components/game/flappy-verified-canvas.tsx", "utf8");
const jumping = fs.readFileSync("components/game/jumping-race-game.tsx", "utf8");
const verticalPages = fs.readFileSync("components/marketing/adsterra-vertical-home-ads.tsx", "utf8");
const layout = fs.readFileSync("app/layout.tsx", "utf8");

test("new game banners use the separate advertising origin and load one size at a time", () => {
  assert.match(banner, /https:\/\/ads\.racetowin\.app\/game-desktop/);
  assert.match(banner, /https:\/\/ads\.racetowin\.app\/game-mobile/);
  assert.match(banner, /sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/);
  assert.match(banner, /referrerPolicy="no-referrer"/);
  assert.doesNotMatch(banner, /bauval\.org/);
  assert.match(banner, /matchMedia/);
});

test("new Home banner stays between game cards and prize banner; game banners only show before play", () => {
  assert.ok(home.indexOf("<AdsterraGameBanners") > home.indexOf('<div className="home-games-grid">'));
  assert.ok(home.indexOf("<AdsterraGameBanners") < home.indexOf('<aside className="home-games-prize"'));
  assert.ok(home.indexOf("<AdsterraHomeAds") > home.indexOf("<AdsterraGameBanners"));
  assert.match(race, /<AdsterraGameBanners className="rtw-game-ad"/);
  assert.match(flappy, /preGameBanner=\{<AdsterraGameBanners className="flappy-game-ad"/);
  assert.match(flappyCanvas, /!expanded && status === "ready" \? preGameBanner : null/);
  assert.match(jumping, /status === "ready" \? <AdsterraGameBanners className="jumping-game-ad"/);
});

test("vertical ads appear only on eligible desktop secondary pages, never Home or games", () => {
  assert.doesNotMatch(home, /<AdsterraVerticalHomeAds|<AdsterraVerticalPageAds/);
  assert.match(layout, /<AdsterraVerticalPageAds>/);
  assert.ok(verticalPages.includes("https://ads.racetowin.app/home-vertical-300"));
  assert.ok(verticalPages.includes("https://ads.racetowin.app/home-vertical-600"));
  assert.match(verticalPages, /sandbox="allow-scripts"/);
  assert.doesNotMatch(verticalPages, /allow-same-origin|bauval\\.org/);
  assert.match(verticalPages, /min-width: 1001px/);
  assert.match(verticalPages, /SIDE_AD_PATHS/);
  assert.ok(!verticalPages.includes('"/games/race-to-win"'));
  assert.ok(!verticalPages.includes('"/games/flappy-race"'));
  assert.ok(!verticalPages.includes('"/games/jumping-race"'));
});
