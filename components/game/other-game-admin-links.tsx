import Link from "next/link";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";

type GameSlug = "race-to-win" | "flappy-race" | "jumping-race";

const labels: Record<GameSlug, string> = {
  "race-to-win": "RACE TO WIN",
  "flappy-race": "FLAPPY RACE",
  "jumping-race": "JUMPING RACE",
};

function dossierLink(slug: GameSlug, playerId: string) {
  const player = encodeURIComponent(playerId);
  if (slug === "race-to-win") return `/admin/prize-review/players?q=${player}`;
  if (slug === "flappy-race") return `/admin/prize-review/flappy-race/players?q=${player}`;
  return `/admin/prize-review/jumping-race?player=${player}`;
}

export async function OtherGameAdminLinks({ playerId, currentGame }: { playerId: string; currentGame: GameSlug }) {
  const authorization = await getAuthorizedPrizeAdmin();
  if (!authorization) return null;

  const { admin } = authorization;
  const { data: games, error: gamesError } = await admin
    .from("games")
    .select("id,slug")
    .in("slug", ["race-to-win", "flappy-race", "jumping-race"]);
  if (gamesError || !games) return null;

  const byId = new Map(games.map(game => [game.id, game.slug as GameSlug]));
  const { data: awards, error: awardsError } = await admin
    .from("provisional_winners")
    .select("game_id,status")
    .eq("player_id", playerId)
    .eq("award_type", "weekly_tournament")
    .in("game_id", games.map(game => game.id));
  if (awardsError) return null;

  const provisionalWins = new Set(
    (awards ?? [])
      .filter(award => award.status !== "disqualified")
      .map(award => byId.get(award.game_id))
      .filter((slug): slug is GameSlug => Boolean(slug)),
  );
  const otherGames = (Object.keys(labels) as GameSlug[]).filter(slug => slug !== currentGame);

  return <section className="profile-card" style={{ padding: "1rem", marginTop: "1rem" }}>
    <h3>OTROS JUEGOS DEL JUGADOR</h3>
    <p>Estos enlaces son privados y solo abren expedientes administrativos del mismo jugador.</p>
    <div className="button-row">
      {otherGames.map(slug => <Link key={slug} className="button button--secondary" href={dossierLink(slug, playerId)}>
        {provisionalWins.has(slug) ? `GANADOR PROVISIONAL EN ${labels[slug]} →` : `VER ${labels[slug]} →`}
      </Link>)}
    </div>
  </section>;
}
