"use client";

import { usePlayerLanguage } from "@/lib/i18n/use-player-language";

export function ScoresIntro() {
  const [language] = usePlayerLanguage();
  const es = language === "es";
  return <>
    <p className="eyebrow">{es ? "RACE TO WIN · RESULTADOS VERIFICADOS" : "RACE TO WIN · VERIFIED RESULTS"}</p>
    <h1>{es ? "CLASIFICACIONES" : "RACE RANKINGS"}</h1>
    <p className="page-lede">{es
      ? "Tus siete mejores partidas verificadas de cada día cuentan para el total semanal. La clasificación mundial utiliza esos mismos totales verificados."
      : "Your seven best verified runs per day count toward the weekly total. The world ranking uses the same verified weekly totals."}</p>
  </>;
}
