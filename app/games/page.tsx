import type { Metadata } from "next";
import { GameCard } from "@/components/marketing/game-card";
import { GAMES } from "@/content/site";

export const metadata: Metadata = { title: "Game" };

export default function GamesPage() {
  return <section className="page-section shell"><p className="eyebrow">GAME 01</p><h1>Race To Win.</h1><p className="page-lede">Race To Win is live. Play the official weekly competition and view the current rules and prize conditions.</p><div className="game-grid game-grid--page">{GAMES.map((game) => <GameCard key={game.slug} game={game} />)}</div></section>;
}
