import type { Metadata } from "next";
import { BackLink } from "@/components/navigation/back-link";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Rules" };

export default function RulesPage() {
  return <section className="page-section shell narrow"><BackLink href={ROUTES.home} /><p className="eyebrow">GENERAL RULES</p><h1>The rules will be on the line before you race.</h1><p className="page-lede">This page is an information framework. Final rules for entry, the game, and any prizes will be announced before those features are active.</p><div className="rule-grid"><article><h2>Guest Scores</h2><p>Guest scores use the same visual game scoring but exist only while the page remains open. They are not saved, cannot be restored, and never enter the tournament, rankings, prizes, or payouts.</p></article><article><h2>Official Tournament Scores</h2><p>Only runs started after sign-in and accepted through server validation can qualify. Registering does not convert any earlier guest score; official scoring starts at zero after sign-in.</p></article><article><h2>Optional Social Sharing</h2><p>Players may share a personal invitation link. Sharing is optional and does not create points, credits, ranking position, tournament eligibility, prizes, or payouts. A click, guest run, or browser-modified value is never proof of an official result.</p></article><article><h2>Results</h2><p>Daily Top 7, weekly totals, positions, and tie-breaks are calculated by the server from validated official runs.</p></article><article><h2>Updates</h2><p>Relevant changes will be communicated clearly before they apply.</p></article></div></section>;
}
