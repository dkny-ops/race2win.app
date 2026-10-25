"use client";

import dynamic from "next/dynamic";
import { RACE_TO_WIN_GAME_SECTION_ID } from "@/lib/routes";

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
        {canStartOfficial ? <RaceToWinScene /> : <RaceToWinScene guest />}
      </div>
      <p className="rtw-local-note">Official sessions validate the final result on the server. The live HUD is display-only.</p>
    </section>
  );
}
