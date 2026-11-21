import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const component = fs.readFileSync("components/marketing/adsterra-home-ads.tsx", "utf8");
const home = fs.readFileSync("components/marketing/localized-home.tsx", "utf8");
const config = fs.readFileSync("next.config.ts", "utf8");

test("Home-only banners load from the dedicated ad origin, not inline provider scripts", () => {
  assert.match(component, /sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/);
  assert.match(component, /src=\{src\}/);
  assert.match(component, /https:\/\/ads\.racetowin\.app\/desktop\//);
  assert.match(component, /https:\/\/ads\.racetowin\.app\/mobile\//);
  assert.match(component, /height=\{90\}/);
  assert.match(component, /height=\{250\}/);
  assert.match(component, /matchMedia/);
  assert.match(component, /if \(mobile === null\) return null/);
  assert.match(component, /mobile\s*\? <AdFrame/);
  assert.doesNotMatch(component, /srcDoc|atOptions|bauval\.org/);
  assert.doesNotMatch(component, /container-e247870efd06877c5c0176c6e3b3bc4d|217c62792bbb2e246c4c2579597fee28/);
  assert.ok(home.indexOf("<AdsterraHomeAds />") > home.indexOf("home-games-prize"));
});

test("Main application CSP allows only the separate ad frame, not provider scripts or unsafe eval", () => {
  assert.match(config, /frame-src [^;]*https:\/\/ads\.racetowin\.app/);
  assert.doesNotMatch(config, /https:\/\/bauval\.org/);
  assert.doesNotMatch(config, /unsafe-eval/);
  assert.doesNotMatch(config, /https:\/\/cdn\.cloudvideosa\.com/);
  assert.match(config, /object-src 'none'/);
  assert.match(config, /frame-ancestors 'none'/);
});
