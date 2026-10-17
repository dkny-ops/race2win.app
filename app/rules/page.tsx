import type { Metadata } from "next";

export const metadata: Metadata = { title: "Rules" };

export default function RulesPage() {
  return <section className="page-section shell narrow"><p className="eyebrow">GENERAL RULES</p><h1>The rules will be on the line before you race.</h1><p className="page-lede">This page is an information framework. Final rules for entry, the game, and any prizes will be announced before those features are active.</p><div className="rule-grid"><article><h2>Game Rules</h2><p>5 opportunities per clock hour in America/New_York, resetting at the start of each hour without accumulation. Extra opportunities require a real rewarded ad verified server-side and are unavailable until a provider is connected. The hourly limit is prepared locally and pending an authorized database migration.</p></article><article><h2>Results</h2><p>The daily score is the sum of your TOP 7 verified official runs. The weekly score sums the daily totals from Monday through Sunday in America/New_York, up to 49 runs. Existing tie-breakers, prizes, withdrawal requirements and human payment approval remain unchanged.</p></article><article><h2>Updates</h2><p>Relevant changes will be communicated clearly before they apply.</p></article></div></section>;
}
