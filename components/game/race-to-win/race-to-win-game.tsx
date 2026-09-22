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

export function RaceToWinGame({ canStartOfficial }: { canStartOfficial: boolean }) {
  return (
    <section className="rtw-game-section rtw-game-section--dedicated" id={RACE_TO_WIN_GAME_SECTION_ID} aria-label="Race To Win game">
      <div className="rtw-game-frame">
        {canStartOfficial ? <RaceToWinScene /> : (
          <div className="rtw-overlay rtw-overlay--ready rtw-auth-gate">
            <p className="rtw-kicker">OFFICIAL PLAY</p>
            <h3>SIGN IN TO RACE</h3>
            <p>Official sessions, checkpoints, and results require a live player session.</p>
            <Link className="rtw-action rtw-action--primary" href={`${ROUTES.signIn}?next=${encodeURIComponent(ROUTES.raceToWinGame)}`}>SIGN IN</Link>
          </div>
        )}
      </div>
      <p className="rtw-local-note">Official sessions validate the final result on the server. The live HUD is display-only.</p>
    </section>
  );
}
