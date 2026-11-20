import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const component = fs.readFileSync("components/marketing/adsterra-home-ads.tsx", "utf8");
const home = fs.readFileSync("components/marketing/localized-home.tsx", "utf8");
const config = fs.readFileSync("next.config.ts", "utf8");

test("Home-only Adsterra banner slots stay sandboxed and isolate each atOptions global", () => {
  assert.match(component, /sandbox="allow-scripts"/);
  assert.match(component, /srcDoc=\{document\}/);
  assert.match(component, /20fdc8466532d667caf530613bd017bb/);
  assert.match(component, /65b7d9f72d18a20dc7345201dc2ef23e/);
  assert.doesNotMatch(component, /container-e247870efd06877c5c0176c6e3b3bc4d/);
  assert.doesNotMatch(component, /217c62792bbb2e246c4c2579597fee28/);
  assert.ok(home.indexOf("<AdsterraHomeAds />") > home.indexOf("home-games-prize"));
});

test("Adsterra banner hosts are explicitly allowlisted without weakening the CSP", () => {
  assert.match(config, /https:\/\/bauval\.org/);
  assert.doesNotMatch(config, /https:\/\/cdn\.cloudvideosa\.com/);
  assert.match(config, /object-src 'none'/);
  assert.match(config, /frame-ancestors 'none'/);
});
