import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button-link";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "How It Works" };

export default function HowItWorksPage() {
  return <section className="page-section shell narrow"><p className="eyebrow">HOW IT WORKS</p><h1>Built one lap at a time.</h1><p className="page-lede">Race To Win begins with a public platform and one focused racing experience. Player access is not active yet.</p><div className="timeline"><article><span>NOW</span><h2>Meet Race To Win</h2><p>Explore the vision and the first game in development.</p></article><article><span>NEXT</span><h2>Player Access</h2><p>Access requirements and the sign-in method will be announced before they open.</p></article><article><span>THEN</span><h2>Run The Track</h2><p>Game information and rules will be published before launch.</p></article></div><ButtonLink href={ROUTES.games}>VIEW THE GAME</ButtonLink></section>;
}
