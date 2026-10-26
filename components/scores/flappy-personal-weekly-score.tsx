"use client";

import { useEffect, useState } from "react";

type PersonalWeek = {
  game: "flappy-race";
  tournamentWeek: string;
  weeklyTotal: number;
  days: { day: string; topScores: number[]; dailyTotal: number }[];
};

function weekday(day: string, language: "en" | "es") {
  return new Intl.DateTimeFormat(language === "es" ? "es-ES" : "en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00.000Z`)).toUpperCase();
}

export function FlappyPersonalWeeklyScore({
  language,
  authenticated,
}: {
  language: "en" | "es";
  authenticated: boolean;
}) {
  const [data, setData] = useState<PersonalWeek | null>(null);
  const [failed, setFailed] = useState(false);
  const es = language === "es";

  useEffect(() => {
    if (!authenticated) {
      setData(null);
      setFailed(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/flappy-race/personal", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unavailable");
        const result = await response.json() as PersonalWeek;
        if (result.game !== "flappy-race" || !Array.isArray(result.days) || result.days.length !== 7) throw new Error("Invalid response");
        if (active) {
          setData(result);
          setFailed(false);
        }
      } catch {
        if (active) {
          setData(null);
          setFailed(true);
        }
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [authenticated]);

  if (!authenticated) return null;
  if (failed) return <p className="scores-message" role="status">{es ? "Tu puntuación semanal no está disponible temporalmente." : "Your weekly score is temporarily unavailable."}</p>;
  if (!data) return <p className="scores-message" role="status">{es ? "CARGANDO TUS PUNTUACIONES…" : "LOADING YOUR SCORES…"}</p>;

  return <section className="scores-page flappy-personal-weekly" aria-labelledby="flappy-personal-weekly-title">
    <div className="scores-panel flappy-personal-weekly__panel">
      <div className="flappy-personal-weekly__heading">
        <div>
          <p className="eyebrow">{es ? "MIS RESULTADOS" : "MY RESULTS"}</p>
          <h2 id="flappy-personal-weekly-title">{es ? "TU SCORE SEMANAL" : "YOUR WEEKLY SCORE"}</h2>
          <p className="flappy-personal-weekly__period">{es ? "Semana de" : "Week of"} {data.tournamentWeek}</p>
        </div>
        <div className="flappy-personal-weekly__total" aria-label={es ? "Total semanal" : "Weekly total"}>
          <span>{es ? "TOTAL SEMANAL" : "WEEKLY TOTAL"}</span>
          <strong>{data.weeklyTotal.toLocaleString(language)}</strong>
        </div>
      </div>
      <p className="flappy-personal-weekly__rule">{es ? "LAS 7 MEJORES PARTIDAS VERIFICADAS DE CADA DÍA" : "YOUR 7 BEST VERIFIED RUNS EACH DAY"}</p>
      <div className="flappy-personal-weekly__days">
        {data.days.map((day) => <article className="flappy-personal-weekly__day" key={day.day}>
          <header>
            <span>{weekday(day.day, language)}</span>
            <strong>{day.dailyTotal.toLocaleString(language)}</strong>
          </header>
          <ol aria-label={(es ? "Tus siete mejores partidas de " : "Your seven best runs for ") + day.day}>
            {Array.from({ length: 7 }, (_, index) => (
              <li key={index}><span>TOP {index + 1}</span><strong>{day.topScores[index] === undefined ? "—" : day.topScores[index].toLocaleString(language)}</strong></li>
            ))}
          </ol>
          <footer><span>{es ? "TOTAL DEL DÍA" : "DAY TOTAL"}</span><strong>{day.dailyTotal.toLocaleString(language)}</strong></footer>
        </article>)}
      </div>
    </div>
  </section>;
}
