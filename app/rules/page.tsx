import type { Metadata } from "next";

export const metadata: Metadata = { title: "Rules" };

export default function RulesPage() {
  return <section className="page-section shell narrow"><p className="eyebrow">GENERAL RULES</p><h1>The rules will be on the line before you race.</h1><p className="page-lede">This page is an information framework. Final rules for entry, the game, and any prizes will be announced before those features are active.</p><div className="rule-grid"><article><h2>Game Rules</h2><p>Every experience will have its own requirements, instructions, and conditions.</p></article><article><h2>Results</h2><p>Validation processes will be explained when the game is active.</p></article><article><h2>Updates</h2><p>Relevant changes will be communicated clearly before they apply.</p></article></div></section>;
}
