import type { Metadata } from "next";
import { GameCard } from "@/components/marketing/game-card";
import { GAMES } from "@/content/site";

export const metadata: Metadata = { title: "Game" };

export default function GamesPage() {
  return <section className="page-section shell"><p className="eyebrow">GAME 01</p><h1>Race To Win.</h1><p className="page-lede">The local playable foundation is available now. Official game details, timing, and rules will be shared before competition features launch.</p><div className="game-grid game-grid--page">{GAMES.map((game) => <GameCard key={game.slug} game={game} />)}</div></section>;
}
