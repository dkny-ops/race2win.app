"use client";
import { usePlayerLanguage } from "@/lib/i18n/use-player-language";
import { FlappyVerifiedCanvas } from "./flappy-verified-canvas";
import { FlappyRankingTable } from "@/components/scores/flappy-ranking";
import { FlappyPersonalWeeklyScore } from "@/components/scores/flappy-personal-weekly-score";

export function FlappyRacePage({ authenticated }: { authenticated: boolean }) {
 const [language] = usePlayerLanguage();
 return <div className="flappy-race-page" style={{ marginTop: ".75rem" }}>
   <FlappyVerifiedCanvas language={language} authenticated={authenticated} />
   <details className="flappy-leaderboard-toggle">
     <summary>LEADERBOARD</summary>
     <FlappyRankingTable language={language} />
   </details>
   <FlappyPersonalWeeklyScore language={language} authenticated={authenticated} />
 </div>;
}
