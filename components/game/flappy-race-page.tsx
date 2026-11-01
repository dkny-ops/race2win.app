"use client";
import { useState } from "react";
import Link from "next/link";
import { usePlayerLanguage } from "@/lib/i18n/use-player-language";
import { FlappyVerifiedCanvas } from "./flappy-verified-canvas";
import { FlappyRankingTable } from "@/components/scores/flappy-ranking";
import { FlappyPersonalWeeklyScore } from "@/components/scores/flappy-personal-weekly-score";

export function FlappyRacePage({ authenticated }: { authenticated: boolean }) {
 const [language] = usePlayerLanguage();
 const [leaderboardOpen, setLeaderboardOpen] = useState(false);
 const [weeklyOpen, setWeeklyOpen] = useState(false);
 const scoreControls = <div className="flappy-score-controls">
   <button className="flappy-score-button" type="button" aria-expanded={leaderboardOpen} aria-controls="flappy-leaderboard-panel" onClick={() => setLeaderboardOpen(!leaderboardOpen)}>LEADERBOARD</button>
   <button className="flappy-score-button" type="button" aria-expanded={weeklyOpen} aria-controls="flappy-weekly-panel" onClick={() => setWeeklyOpen(!weeklyOpen)}>WEEKLY SCORE</button>
 </div>;
 return <div className="flappy-race-page" style={{ marginTop: ".75rem" }}>
   <FlappyVerifiedCanvas language={language} authenticated={authenticated} scoreControls={scoreControls} />
   <Link className="rtw-game-how-to-play-link rtw-game-how-to-play-link--flappy flappy-bottom-help" href="/games/flappy-race/how-to-play"><span aria-hidden="true">ⓘ</span> HOW TO PLAY</Link>
   <div id="flappy-leaderboard-panel" hidden={!leaderboardOpen}>
     {leaderboardOpen ? <FlappyRankingTable language={language} /> : null}
   </div>
   <div id="flappy-weekly-panel" hidden={!weeklyOpen}>
     {weeklyOpen ? <FlappyPersonalWeeklyScore language={language} authenticated={authenticated} /> : null}
   </div>
 </div>;
}
