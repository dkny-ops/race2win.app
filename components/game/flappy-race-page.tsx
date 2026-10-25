"use client";
import { useEffect, useState } from "react";
import { FlappyVerifiedCanvas } from "./flappy-verified-canvas";
import { FlappyRankingTable } from "@/components/scores/flappy-ranking";

export function FlappyRacePage({ authenticated }: { authenticated: boolean }) {
 const [language, setLanguage] = useState<"en" | "es">("en");
 useEffect(() => {
  const stored = localStorage.getItem("raceToWinLanguage");
  const locale = stored === "en" || stored === "es" ? stored : navigator.languages?.[0] || navigator.language || "en";
  setLanguage(locale.toLowerCase().startsWith("es") ? "es" : "en");
 }, []);
 return <div style={{ marginTop: "1.5rem" }}><FlappyVerifiedCanvas language={language} authenticated={authenticated} /><FlappyRankingTable language={language} /></div>;
}
