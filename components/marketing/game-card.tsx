import type { PublicGame } from "@/types/public-types";
import { PlayGameLink } from "@/components/game/race-to-win/play-game-link";
import { RACE_TO_WIN_GAME_SLUG } from "@/lib/routes";

export function GameCard({ game }: { game: PublicGame }) {
  return (
    <article className={`game-card game-card--${game.accent}`}>
      <div className="game-card-art" aria-hidden="true"><span>RTW</span></div>
      <p className="eyebrow">{game.status}</p>
      <h3>{game.title}</h3>
      <p>{game.description}</p>
      {game.slug === RACE_TO_WIN_GAME_SLUG ? (
        <PlayGameLink variant="text" className="game-card-link">PLAY <span aria-hidden="true">→</span></PlayGameLink>
      ) : (
        <span className="game-card-link">GAME DETAILS COMING SOON <span aria-hidden="true">→</span></span>
      )}
    </article>
  );
}
