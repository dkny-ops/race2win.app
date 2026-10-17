"use client";
import { useEffect, useState } from "react";
import { PendingRun } from "@/components/scores/pending-run";

type Entry = { rank: number; username: string; weeklyTotal: number };
type Board = { game: { name: string }; tournamentWeek: string; page: number; hasNextPage: boolean; entries: Entry[] };
type Personal = { tournamentWeek: string; weeklyTotal: number; dailyTop7: { day: string; rank: number; score: number }[]; pendingRuns?: { sessionId: string; score: number; tournamentDay: string }[] };
const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

function weekDays(week: string): string[] {
  const start = new Date(week + "T12:00:00Z");
  if (Number.isNaN(start.getTime())) return [];
  return weekdays.map((_, i) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    return day.toISOString().slice(0, 10);
  });
}

export function LeaderboardTable() {
  const [data, setData] = useState<Board | null>(null);
  const [personal, setPersonal] = useState<Personal | null>(null);
  const [personalStatus, setPersonalStatus] = useState<"loading" | "sign-in" | "unavailable" | "ready">("loading");
  const [page, setPage] = useState(1);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const loadPersonal = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/scores/me", { cache: "no-store", credentials: "same-origin" });
        if (!active) return;
        if (response.status === 401) { setPersonal(null); setPersonalStatus("sign-in"); return; }
        if (!response.ok) throw new Error("Unavailable");
        const body = await response.json() as Personal;
        if (active) { setPersonal(body); setPersonalStatus("ready"); }
      } catch {
        if (active) setPersonalStatus("unavailable");
      } finally { inFlight = false; }
    };
    void loadPersonal();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void loadPersonal(); }, 30_000);
    const onFocus = () => { void loadPersonal(); };
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const loadLeaderboard = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/leaderboard?page=${page}&pageSize=50`, { cache: "no-store" });
        if (!response.ok) throw new Error("Unavailable");
        const body = await response.json() as Board;
        if (active) { setData(body); setError(false); }
      } catch { if (active) setError(true); }
      finally { inFlight = false; }
    };
    void loadLeaderboard();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void loadLeaderboard(); }, 60_000);
    const onFocus = () => { void loadLeaderboard(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void loadLeaderboard(); };
    const onScoreVerified = () => { void loadLeaderboard(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("rtw:score-verified", onScoreVerified);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("rtw:score-verified", onScoreVerified); };
  }, [page]);

  function changePage(next: number) { setData(null); setError(false); setPage(next); }
  const week = personal?.tournamentWeek ?? data?.tournamentWeek;
  const days = week ? weekDays(week) : [];
  const totals = new Map<string, number>();
  const runsForDay = (day: string) => (personal?.dailyTop7 ?? []).filter(e => e.day === day).sort((a,b) => a.rank - b.rank);
  for (const entry of personal?.dailyTop7 ?? []) totals.set(entry.day, (totals.get(entry.day) ?? 0) + entry.score);

  return <div className="scores-ranking-grid">
    <section className="scores-panel scores-ranking-panel scores-ranking-panel--world" aria-label="World ranking">
      <div className="scores-ranking-title"><span className="scores-ranking-symbol" aria-hidden="true">🏆</span><div><p className="eyebrow">GLOBAL WEEKLY LEADERBOARD</p><h2>RANKING MUNDIAL</h2></div></div>
      <p className="scores-ranking-subtitle">BEST 7 VERIFIED RUNS EACH DAY · WEEKLY SUM</p>
      <p className="muted" style={{ fontSize: "0.75rem" }}>El ranking se consulta cada minuto. Los resultados verificados en este dispositivo se actualizan al instante; en otros dispositivos pueden tardar hasta un minuto.</p>
      {error ? <p className="scores-message" role="status">The world leaderboard is temporarily unavailable.</p>
        : !data ? <p className="scores-message" role="status">LOADING WORLD RANKING…</p>
        : data.entries.length === 0 ? <p className="scores-message">No public ranked scores for this week yet.</p>
        : <div className="scores-table scores-ranking-table scores-table--leaderboard" role="table" aria-label="Race To Win world ranking">
          <div className="scores-table__header" role="row"><span role="columnheader">RANK</span><span role="columnheader">RACER</span><span role="columnheader">SCORE</span></div>
          {data.entries.map(entry => <div className={`scores-table__row ranking-row${entry.rank <= 3 ? ` ranking-row--${entry.rank}` : ""}`} role="row" key={entry.rank}>
            <strong role="cell" className="scores-rank-position">{entry.rank <= 3 ? <span aria-hidden="true" className="ranking-medal">{entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : "🥉"}</span> : null}<span>#{entry.rank}</span></strong>
            <span role="cell">{entry.username}</span><strong role="cell">{entry.weeklyTotal.toLocaleString()}</strong>
          </div>)}
        </div>}
      <div className="scores-pagination"><button className="button button--secondary" type="button" disabled={page === 1 || !data} onClick={() => changePage(page - 1)}>PREVIOUS</button><span aria-live="polite">PAGE {data?.page ?? page}</span><button className="button button--secondary" type="button" disabled={!data?.hasNextPage} onClick={() => changePage(page + 1)}>NEXT</button></div>
    </section>
    <section className="scores-panel scores-ranking-panel" aria-label="My weekly score">
      <div className="scores-ranking-title"><span className="scores-ranking-symbol" aria-hidden="true">★</span><div><p className="eyebrow">TOP 7 VERIFIED RUNS PER DAY</p><h2>MY WEEKLY SCORE</h2></div></div>
      <p className="scores-ranking-subtitle">{week ? `WEEK OF ${week} · NEW YORK TIME` : "MONDAY — SUNDAY"}</p>
      {(personal?.pendingRuns ?? []).map((run) => <PendingRun key={run.sessionId} sessionId={run.sessionId} score={run.score} day={run.tournamentDay} />)}
      {personalStatus === "loading" ? <p className="scores-message" role="status">LOADING WEEKLY SCORES…</p>
        : personalStatus === "sign-in" ? <p className="scores-message" role="status">Sign in to see your seven daily totals and weekly score.</p>
        : personalStatus === "unavailable" ? <p className="scores-message" role="status">Your weekly scores are temporarily unavailable.</p>
        : <><div className="scores-table scores-ranking-table" role="table" aria-label="Your daily top seven totals">
          <div className="scores-table__header" role="row"><span role="columnheader">DAY</span><span role="columnheader">TOP 7 RUNS</span><span role="columnheader">TOTAL</span></div>
          {days.map((day, i) => <div className="scores-day-group" key={day}>
            <button className={`scores-day-button scores-table__row${selectedDay === day ? " scores-day-button--active" : ""}`} type="button" aria-expanded={selectedDay === day} aria-controls={`daily-runs-${i}`} onClick={() => setSelectedDay(selectedDay === day ? null : day)}>
              <strong>{weekdays[i]} <span className="scores-day-chevron" aria-hidden="true">{selectedDay === day ? "▴" : "▾"}</span></strong><span>{runsForDay(day).length} / 7</span><strong>{(totals.get(day) ?? 0).toLocaleString()}</strong>
            </button>
            {selectedDay === day ? <div className="scores-day-runs" id={`daily-runs-${i}`}>
              <p className="scores-day-runs__title">{day} · TOP 7 VERIFIED SCORES</p>
              {runsForDay(day).length ? runsForDay(day).map(run => <div className="scores-day-run" key={run.rank}><span>#{run.rank}</span><strong>{run.score.toLocaleString()}</strong><span>VERIFIED</span></div>) : <p className="muted">No verified scores for this day.</p>}
            </div> : null}
          </div>)}
        </div><div className="scores-ranking-total"><span>WEEKLY TOTAL</span><strong>{(personal?.weeklyTotal ?? 0).toLocaleString()}</strong></div></>}
    </section>
  </div>;
}
