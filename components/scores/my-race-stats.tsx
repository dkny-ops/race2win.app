"use client";

import { useEffect, useState } from "react";

type PersonalScores = { tournamentWeek: string; game: { slug: string; name: string }; weeklyTotal: number; rank: number | null; dailyTop7: { day: string; rank: number; score: number }[]; recentValidatedRuns: { score: number; distanceMillimeters: number; elapsedMs: number; completedAt: string; tournamentDay: string }[] };

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function MyRaceStats() {
  const [data, setData] = useState<PersonalScores | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/scores/me", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json().catch(() => null) })).then(({ response, body }) => {
      if (!active) return;
      if (!response.ok || !body) return setError("Your current race stats are unavailable. Please try again shortly.");
      setData(body as PersonalScores);
    }).catch(() => { if (active) setError("Your current race stats are unavailable. Please try again shortly."); });
    return () => { active = false; };
  }, []);
  if (error) return <p className="scores-message" role="status">{error}</p>;
  if (!data) return <p className="scores-message" role="status">LOADING YOUR RACE STATS…</p>;
  return <div className="scores-layout">
    <section className="scores-summary" aria-label="Weekly score summary"><div><span>WEEK</span><strong>{data.tournamentWeek}</strong></div><div><span>WEEKLY TOTAL</span><strong>{data.weeklyTotal.toLocaleString()}</strong></div><div><span>WORLD RANK</span><strong>{data.rank ? `#${data.rank}` : "—"}</strong></div></section>
    <section className="scores-panel"><p className="eyebrow">TOP 7 BY DAY</p><h2>YOUR COUNTING RUNS</h2>{data.dailyTop7.length === 0 ? <p className="muted">Validated runs will appear here after an official run is finalized.</p> : <div className="scores-table" role="table" aria-label="Daily Top 7 scores"><div className="scores-table__header" role="row"><span>DAY</span><span>DAILY RANK</span><span>SCORE</span></div>{data.dailyTop7.map((entry) => <div role="row" key={`${entry.day}-${entry.rank}`}><span>{entry.day}</span><span>#{entry.rank}</span><strong>{entry.score.toLocaleString()}</strong></div>)}</div>}</section>
    <section className="scores-panel"><p className="eyebrow">RECENT VALIDATED RUNS</p><h2>RUN HISTORY</h2>{data.recentValidatedRuns.length === 0 ? <p className="muted">No validated runs yet.</p> : <div className="scores-table" role="table" aria-label="Recent validated runs"><div className="scores-table__header" role="row"><span>DAY</span><span>SCORE</span><span>DISTANCE / TIME</span></div>{data.recentValidatedRuns.map((run) => <div role="row" key={`${run.completedAt}-${run.score}`}><span>{run.tournamentDay}</span><strong>{run.score.toLocaleString()}</strong><span>{Math.floor(run.distanceMillimeters / 1000).toLocaleString()} M · {formatDuration(run.elapsedMs)}</span></div>)}</div>}</section>
  </div>;
}
