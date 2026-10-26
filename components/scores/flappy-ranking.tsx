"use client";
import { useEffect, useState } from "react";
import type { FlappyRanking } from "@/lib/competition/flappy-ranking";

export function FlappyRankingTable({ language }: { language: "en" | "es" }) {
  const [page, setPage] = useState(1);
  const [board, setBoard] = useState<FlappyRanking | null>(null);
  const [error, setError] = useState(false);
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
  </section>;
}
