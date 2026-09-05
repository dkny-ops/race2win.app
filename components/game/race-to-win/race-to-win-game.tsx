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

export function RaceToWinGame() {
  return (
    <section className="rtw-game-section rtw-game-section--dedicated" id={RACE_TO_WIN_GAME_SECTION_ID} aria-label="Race To Win game">
      <div className="rtw-game-frame">
        <RaceToWinScene />
      </div>
      <p className="rtw-local-note">This local gameplay foundation stores no score or result and sends no gameplay data to the server.</p>
    </section>
  );
}
