"use client";
import { usePlayerLanguage } from "@/lib/i18n/use-player-language";
import { FlappyVerifiedCanvas } from "./flappy-verified-canvas";
import { FlappyRankingTable } from "@/components/scores/flappy-ranking";
import { FlappyPersonalWeeklyScore } from "@/components/scores/flappy-personal-weekly-score";

export function FlappyRacePage({ authenticated }: { authenticated: boolean }) {
 const [language] = usePlayerLanguage();
 return <div style={{ marginTop: ".75rem" }}>
   <FlappyVerifiedCanvas language={language} authenticated={authenticated} />
   <FlappyRankingTable language={language} />
   <FlappyPersonalWeeklyScore language={language} authenticated={authenticated} />
 </div>;
}
