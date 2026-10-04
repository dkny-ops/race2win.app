"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { RACE_TO_WIN_GAME_SECTION_ID, ROUTES } from "@/lib/routes";

const RaceToWinScene = dynamic(
  () => import("./race-to-win-scene").then((module) => module.RaceToWinScene),
  {
    ssr: false,
    loading: () => <div className="rtw-loading" role="status">LOADING TRACK…</div>,
  },
);

export function RaceToWinGame({ canStartOfficial, playerName }: { canStartOfficial: boolean; playerName: string }) {
  return (
    <section className="rtw-game-section rtw-game-section--dedicated" id={RACE_TO_WIN_GAME_SECTION_ID} aria-label="Race To Win game">
      <div className="rtw-game-frame">
        <RaceToWinScene officialMode={canStartOfficial} playerName={playerName} />
      </div>
      {canStartOfficial ? (
        <p className="rtw-local-note">Official sessions validate the final result on the server. The live HUD is display-only.</p>
      ) : (
        <div className="rtw-local-note rtw-guest-note"><p>Play for free without signing in. Sign in to save your scores, compete in tournaments and qualify for prizes. Guest scores are not saved.</p><Link href={`${ROUTES.signIn}?next=${encodeURIComponent(ROUTES.raceToWinGame)}`}>SIGN IN TO COMPETE</Link></div>
      )}
    </section>
  );
}
