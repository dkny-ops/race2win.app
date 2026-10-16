import type { Metadata } from "next";
import { BackLink } from "@/components/navigation/back-link";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return <section className="page-section shell narrow legal-copy"><BackLink href={ROUTES.home} /><p className="eyebrow">PROVISIONAL FRAMEWORK</p><h1>Terms of Use</h1><p className="page-lede">This page is an initial information framework. It is not final terms or a promise of availability.</p><h2>Guest Play and Scores</h2><p>Guest score displays are recreational and memory-only. Closing or reloading the page removes them. They are not tournament entries and cannot be submitted, restored, or converted into official results after registration.</p><h2>Official Competition</h2><p>Only runs started after sign-in and independently accepted by Race To Win servers may be stored, ranked, or considered for tournament eligibility. Visual browser values are not proof of an official result.</p><h2>Optional Social Sharing</h2><p>A personal invitation link may be shared voluntarily. Sharing, clicking an invitation, or attaching an invitation does not create points, credits, ranking placement, tournament eligibility, prizes, or payouts. Guest activity, browser-modified values, and unvalidated runs cannot change this.</p><h2>Platform Status</h2><p>Race To Win is in development. Features, services, and conditions may change before launch.</p><h2>Game Participation</h2><p>Rules, requirements, restrictions, and conditions for the game will be published before it is available.</p><h2>Final Information</h2><p>Complete terms must be reviewed and published before accounts, participation, or any prize program are enabled.</p></section>;
}
