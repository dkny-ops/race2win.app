"use client";

import { usePlayerLanguage } from "@/lib/i18n/use-player-language";

export function ScoresIntro() {
  const [language, setLanguage] = usePlayerLanguage();
  const es = language === "es";
  return <>
    <p className="eyebrow">{es ? "RACE TO WIN · RESULTADOS VERIFICADOS" : "RACE TO WIN · VERIFIED RESULTS"}</p>
    <h1>{es ? "CLASIFICACIONES" : "RACE RANKINGS"}</h1>
    <p className="page-lede">{es
      ? "Tus siete mejores partidas verificadas de cada día cuentan para el total semanal. La clasificación mundial utiliza esos mismos totales verificados."
      : "Your seven best verified runs per day count toward the weekly total. The world ranking uses the same verified weekly totals."}</p>
    <label>{es ? "Idioma" : "Language"}{" "}
      <select aria-label="Language / Idioma" value={language} onChange={(event) => setLanguage(event.target.value === "es" ? "es" : "en")}>
        <option value="en">English</option><option value="es">Español</option>
      </select>
    </label>
  </>;
}
