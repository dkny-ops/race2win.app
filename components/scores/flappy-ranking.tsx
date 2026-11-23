"use client";
import { useEffect, useState } from "react";
import type { FlappyRanking } from "@/lib/competition/flappy-ranking";
import { weeklyPrizeLabelForRank } from "@/lib/competition/weekly-prizes";

export function FlappyRankingTable({ language }: { language: "en" | "es" }) {
  const [page, setPage] = useState(1);
  const [board, setBoard] = useState<FlappyRanking | null>(null);
  const [error, setError] = useState(false);
  const [previous, setPrevious] = useState<{ tournamentWeek: string; entries: { rank: number; username: string; weeklyTotal: number }[] } | null>(null);
  const [previousError, setPreviousError] = useState(false);
  const es = language === "es";
  useEffect(() => {
    let active = true, inFlight = false;
    const controller = new AbortController();
    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/flappy-race/leaderboard?page=${page}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unavailable");
        const result = await response.json() as FlappyRanking;
        if (result.game !== "flappy-race" || result.page !== page || !Array.isArray(result.entries)) throw new Error("Invalid ranking");
        if (active) { setBoard(result); setError(false); }
      } catch { if (active) { setBoard(null); setError(true); } }
      finally { inFlight = false; }
    }
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    const focus = () => { void load(); };
    window.addEventListener("focus", focus);
    return () => { active = false; controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [page]);
  useEffect(() => {
    let active = true;
    async function loadPrevious() {
      try {
        const response = await fetch("/api/flappy-race/leaderboard/last-week", { cache: "no-store" });
        if (!response.ok) throw new Error("Unavailable");
        const result = await response.json();
        if (!Array.isArray(result.entries) || typeof result.tournamentWeek !== "string") throw new Error("Invalid results");
        if (active) { setPrevious(result); setPreviousError(false); }
      } catch { if (active) setPreviousError(true); }
    }
    void loadPrevious();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadPrevious(); }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  function changePage(next: number) { setBoard(null); setError(false); setPage(next); }
  return <section className="scores-page flappy-ranking" aria-labelledby="flappy-ranking-title">
    <div className="scores-panel scores-ranking-panel">
      <p className="eyebrow">FLAPPYRACE</p>
      <h2 id="flappy-ranking-title">LEADERBOARD</h2>
      {error ? <p role="status" className="scores-message">{es ? "El ranking no está disponible temporalmente." : "The ranking is temporarily unavailable."}</p>
        : !board ? <p role="status" className="scores-message">{es ? "Cargando ranking…" : "Loading ranking…"}</p>
        : board.entries.length === 0 ? <p role="status" className="scores-message">{es ? "Todavía no hay puntuaciones oficiales verificadas de FlappyRace esta semana." : "No verified official FlappyRace scores this week yet."}</p>
        : <div className="scores-table scores-ranking-table scores-table--leaderboard" role="table" aria-label={es ? "Ranking semanal de FlappyRace" : "FlappyRace weekly ranking"}>
          <div className="scores-table__header" role="row"><span role="columnheader">{es ? "PUESTO" : "RANK"}</span><span role="columnheader">{es ? "JUGADOR" : "PLAYER"}</span><span role="columnheader">{es ? "PUNTOS" : "SCORE"}</span></div>
          {board.entries.map(entry => <div key={entry.username} role="row" className={`scores-table__row ranking-row${entry.rank !== null && entry.rank >= 1 && entry.rank <= 3 ? ` ranking-row--${entry.rank}` : ""}`}>
            <strong role="cell" className="scores-rank-position">{entry.reviewRequired ? (es ? "Revisión" : "Review") : `#${entry.rank}`}</strong>
            <span role="cell">{entry.username}{entry.reviewRequired ? <small className="flappy-ranking__review">{es ? "Empate absoluto · pendiente de revisión" : "Exact tie · pending review"}</small> : null}</span>
            <strong role="cell">{entry.weeklyTotal.toLocaleString(language)}</strong>
          </div>)}
        </div>}
      <div className="scores-pagination">
        <button className="button button--secondary" type="button" disabled={page === 1 || !board} onClick={() => changePage(page - 1)}>{es ? "ANTERIOR" : "PREVIOUS"}</button>
        <span aria-live="polite">{es ? "PÁGINA" : "PAGE"} {page}</span>
        <button className="button button--secondary" type="button" disabled={!board?.hasNextPage || page >= 100} onClick={() => changePage(page + 1)}>{es ? "SIGUIENTE" : "NEXT"}</button>
      </div>
    </div>
    <div className="scores-panel scores-ranking-panel" aria-label="Last week winners" style={{ marginTop: 24 }}>
      <div className="scores-ranking-title"><span className="scores-ranking-symbol" aria-hidden="true">🏆</span><div>
        <p className="eyebrow">{es ? "SEMANA ANTERIOR · HORA DE NUEVA YORK" : "PREVIOUS WEEK · NEW YORK TIME"}</p>
        <h2>{es ? "GANADORES DE LA SEMANA PASADA" : "LAST WEEK WINNERS"}</h2>
      </div></div>
      <p className="scores-ranking-subtitle">{"WEEK OF " + (previous?.tournamentWeek ?? "LAST COMPLETED WEEK")} · {es ? "RESULTADOS DE PRUEBA · SIN PREMIOS" : "TEST RESULTS · NO PRIZES"}</p>
      {previousError ? <p role="status" className="scores-message">{es ? "Resultados temporalmente no disponibles." : "Previous week results temporarily unavailable."}</p>
        : !previous ? <p role="status" className="scores-message">{es ? "Cargando semana anterior…" : "Loading last week…"}</p>
        : previous.entries.length === 0 ? <p className="scores-message">{es ? "No hay puntuaciones verificadas de la semana anterior." : "No verified scores for last week."}</p>
        : <div className="scores-table scores-ranking-table scores-table--leaderboard" role="table" aria-label="Flappy Race previous week top three">
          <div className="scores-table__header" role="row"><span role="columnheader">RANK</span><span role="columnheader">RACER</span><span role="columnheader">SCORE</span></div>
          {previous.entries.map(entry => <div className={"scores-table__row ranking-row ranking-row--" + entry.rank} role="row" key={entry.rank}>
            <strong role="cell" className="scores-rank-position"><span aria-hidden="true" className="ranking-medal">{entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : "🥉"}</span><span>#{entry.rank}</span></strong>
            <span role="cell">{entry.username}<span style={{ marginLeft: "0.5rem", fontWeight: 700 }}>· {weeklyPrizeLabelForRank(entry.rank)}</span></span><strong role="cell">{entry.weeklyTotal.toLocaleString(language)}</strong>
          </div>)}
        </div>}
    </div>
  </section>;
}
