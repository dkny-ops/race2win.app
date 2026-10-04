"use client";

import { useEffect, useMemo, useState } from "react";
import { useGuestScores, type GuestRun } from "./guest-score-store";

type Leaderboard = { game: { name: string }; tournamentWeek: string; page: number; pageSize: number; entries: { rank: number; username: string; weeklyTotal: number }[] };
const LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

function weekDays(weekStart: string) {
  const monday = new Date(`${weekStart}T00:00:00.000Z`);
  return LABELS.map((label, offset) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + offset);
    return { label, value: date.toISOString().slice(0, 10) };
  });
}

function newYorkDay(completedAt: string): string | null {
  const date = new Date(completedAt);
  if (Number.isNaN(date.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year"); const month = values.get("month"); const day = values.get("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function topSevenForDay(runs: readonly GuestRun[], day: string) {
  return runs.filter((run) => newYorkDay(run.completedAt) === day)
    .sort((left, right) => right.score - left.score || left.completedAt.localeCompare(right.completedAt))
    .slice(0, 7)
    .map((run, index) => ({ day, rank: index + 1, score: run.score }));
}

export function GuestRaceStats({ tournamentWeek }: Readonly<{ tournamentWeek: string }>) {
  const { runs } = useGuestScores();
  const [tab, setTab] = useState<"weekly" | "world">("weekly");
  const [worldPage, setWorldPage] = useState(1);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const days = useMemo(() => weekDays(tournamentWeek), [tournamentWeek]);
  const dailyTop7 = useMemo(() => days.flatMap((day) => topSevenForDay(runs, day.value)), [days, runs]);
  const weeklyTotal = useMemo(() => dailyTop7.reduce((sum, entry) => sum + entry.score, 0), [dailyTop7]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/leaderboard?page=${worldPage}&pageSize=50`, { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json().catch(() => null) }))
      .then((result) => {
        if (!active) return;
        if (!result.response.ok || !result.body) { setLeaderboardError("World players are temporarily unavailable. Please try again shortly."); return; }
        setLeaderboard(result.body as Leaderboard);
      }).catch(() => { if (active) setLeaderboardError("World players are temporarily unavailable. Please try again shortly."); });
    return () => { active = false; };
  }, [worldPage]);

  return <div className="scores-layout">
    <section className="scores-summary" aria-label="Guest session weekly summary">
      <div><span>TOURNAMENT WEEK</span><strong>{tournamentWeek}</strong></div>
      <div><span>WEEKLY TOTAL</span><strong>{weeklyTotal.toLocaleString()}</strong></div>
      <div><span>WORLD POSITION</span><strong>NOT ELIGIBLE</strong></div>
    </section>
    <p className="scores-footnote">Guest scores use the same game scoring display, stay only in this open page, and never enter the tournament, prizes, or World Players. Signing in clears them; only new server-validated runs can qualify.</p>
    <div className="scores-tabs" role="tablist" aria-label="Score views">
      <button className={tab === "weekly" ? "scores-tab scores-tab--active" : "scores-tab"} type="button" role="tab" aria-selected={tab === "weekly"} onClick={() => setTab("weekly")}>WEEKLY</button>
      <button className={tab === "world" ? "scores-tab scores-tab--active" : "scores-tab"} type="button" role="tab" aria-selected={tab === "world"} onClick={() => setTab("world")}>WORLD PLAYERS</button>
    </div>
    {tab === "weekly" ? <section className="scores-panel" role="tabpanel">
      <div className="scores-panel__heading"><div><p className="eyebrow">GUEST TOP 7 · NOT SAVED</p><h2>WEEKLY</h2></div><span className="scores-game-label">NEW YORK TIME</span></div>
      <div className="scores-week-grid" aria-label="Guest daily Top 7 scores for the week">{days.map((day) => {
        const scores = dailyTop7.filter((entry) => entry.day === day.value);
        return <section className="scores-day-panel" key={day.value} aria-label={`${day.label} guest Top 7`}><h3>{day.label}</h3>{scores.length === 0 ? <p className="muted">No scores yet</p> : <div className="scores-table" role="table" aria-label={`${day.label} guest Top 7 scores`}><div className="scores-table__header" role="row"><span>POSITION</span><span>SCORE</span></div>{scores.map((entry) => <div role="row" key={`${entry.day}-${entry.rank}`}><strong>#{entry.rank}</strong><strong>{entry.score.toLocaleString()}</strong></div>)}</div>}</section>;
      })}</div>
      <div className="scores-week-total" aria-label="Guest weekly total"><span>WEEKLY TOTAL</span><strong>{weeklyTotal.toLocaleString()}</strong></div>
    </section> : !leaderboard ? <p className="scores-message" role="status">{leaderboardError ?? "LOADING WORLD PLAYERS…"}</p> : <section className="scores-panel" role="tabpanel">
      <div className="scores-panel__heading"><div><p className="eyebrow">SERVER-VALIDATED TOTALS</p><h2>WORLD PLAYERS</h2></div><span className="scores-game-label">{leaderboard.game.name}</span></div>
      {leaderboard.entries.length === 0 ? <p className="muted">No scores yet</p> : <div className="scores-table scores-table--leaderboard" role="table" aria-label="World players leaderboard"><div className="scores-table__header" role="row"><span>POSITION</span><span>PLAYER</span><span>WEEKLY TOTAL</span></div>{leaderboard.entries.map((entry) => <div role="row" key={`${entry.rank}-${entry.username}`}><strong>#{entry.rank}</strong><span>{entry.username}</span><strong>{entry.weeklyTotal.toLocaleString()}</strong></div>)}</div>}
      <div className="scores-pagination"><button className="button button--secondary" type="button" disabled={worldPage === 1} onClick={() => { setLeaderboardError(null); setWorldPage(worldPage - 1); }}>PREVIOUS</button><span>PAGE {leaderboard.page}</span><button className="button button--secondary" type="button" disabled={leaderboard.entries.length < leaderboard.pageSize} onClick={() => { setLeaderboardError(null); setWorldPage(worldPage + 1); }}>NEXT</button></div>
    </section>}
  </div>;
}
