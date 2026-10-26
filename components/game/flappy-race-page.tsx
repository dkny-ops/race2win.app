"use client";
import { usePlayerLanguage } from "@/lib/i18n/use-player-language";
import { FlappyVerifiedCanvas } from "./flappy-verified-canvas";
import { FlappyRankingTable } from "@/components/scores/flappy-ranking";

export function FlappyRacePage({ authenticated }: { authenticated: boolean }) {
 const [language] = usePlayerLanguage();
 return <div style={{ marginTop: ".75rem" }}><FlappyVerifiedCanvas language={language} authenticated={authenticated} /><FlappyRankingTable language={language} /></div>;
}
