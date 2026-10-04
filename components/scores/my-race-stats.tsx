"use client";

import { useEffect, useMemo, useState } from "react";

type DailyTopScore = { day: string; rank: number; score: number };
type PersonalScores = { tournamentWeek: string; game: { slug: string; name: string }; weeklyTotal: number; rank: number | null; dailyTop7: DailyTopScore[] };
type Leaderboard = { game: { slug: string; name: string }; tournamentWeek: string; page: number; pageSize: number; entries: { rank: number; username: string; weeklyTotal: number }[] };

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

function weekDays(weekStart: string) {
  const monday = new Date(`${weekStart}T00:00:00.000Z`);
  return WEEKDAY_LABELS.map((label, offset) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + offset);
    return { label, value: date.toISOString().slice(0, 10) };
  });
}

export function MyRaceStats() {
  const [personal, setPersonal] = useState<PersonalScores | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [tab, setTab] = useState<"weekly" | "world">("weekly");
  const [worldPage, setWorldPage] = useState(1);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/scores/me", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json().catch(() => null) })).then((personalResult) => {
      if (!active) return;
      if (!personalResult.response.ok || !personalResult.body) {
        setPersonalError("Official weekly scores are temporarily unavailable. Please try again shortly.");
        return;
      }
      const nextPersonal = personalResult.body as PersonalScores;
      setPersonal(nextPersonal);
    }).catch(() => {
      if (active) setPersonalError("Official weekly scores are temporarily unavailable. Please try again shortly.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch(`/api/leaderboard?page=${worldPage}&pageSize=50`, { cache: "no-store" }).then(async (response) => ({ response, body: await response.json().catch(() => null) })).then((leaderboardResult) => {
      if (!active) return;
      if (!leaderboardResult.response.ok || !leaderboardResult.body) {
        setLeaderboardError("World players are temporarily unavailable. Please try again shortly.");
        return;
      }
      setLeaderboard(leaderboardResult.body as Leaderboard);
    }).catch(() => {
      if (active) setLeaderboardError("World players are temporarily unavailable. Please try again shortly.");
    });
    return () => { active = false; };
  }, [worldPage]);

  function changeWorldPage(nextPage: number) {
    setLeaderboardError(null);
    setWorldPage(nextPage);
  }

  const days = useMemo(() => personal ? weekDays(personal.tournamentWeek) : [], [personal]);

  return <div className="scores-layout">
    {personal ? <section className="scores-summary" aria-label="Official weekly summary">
      <div><span>TOURNAMENT WEEK</span><strong>{personal.tournamentWeek}</strong></div>
      <div><span>WEEKLY TOTAL</span><strong>{personal.weeklyTotal.toLocaleString()}</strong></div>
      <div><span>WORLD POSITION</span><strong>{personal.rank ? `#${personal.rank}` : "—"}</strong></div>
    </section> : null}

    <div className="scores-tabs" role="tablist" aria-label="Score views">
      <button className={tab === "weekly" ? "scores-tab scores-tab--active" : "scores-tab"} type="button" role="tab" aria-selected={tab === "weekly"} onClick={() => setTab("weekly")}>WEEKLY</button>
      <button className={tab === "world" ? "scores-tab scores-tab--active" : "scores-tab"} type="button" role="tab" aria-selected={tab === "world"} onClick={() => setTab("world")}>WORLD PLAYERS</button>
    </div>

    {tab === "weekly" ? !personal ? <p className="scores-message" role="status">{personalError ?? "LOADING OFFICIAL SCORES…"}</p> : <section className="scores-panel" role="tabpanel">
      <div className="scores-panel__heading"><div><p className="eyebrow">OFFICIAL TOP 7</p><h2>WEEKLY</h2></div><span className="scores-game-label">NEW YORK TIME</span></div>
      <div className="scores-week-grid" aria-label="Official daily Top 7 scores for the week">{days.map((day) => {
        const scores = personal.dailyTop7.filter((entry) => entry.day === day.value).sort((left, right) => left.rank - right.rank);
        return <section className="scores-day-panel" key={day.value} aria-label={`${day.label} official Top 7`}><h3>{day.label}</h3>{scores.length === 0 ? <p className="muted">No scores yet</p> : <div className="scores-table" role="table" aria-label={`${day.label} official Top 7 scores`}><div className="scores-table__header" role="row"><span>POSITION</span><span>SCORE</span></div>{scores.map((entry) => <div role="row" key={`${entry.day}-${entry.rank}`}><strong>#{entry.rank}</strong><strong>{entry.score.toLocaleString()}</strong></div>)}</div>}</section>;
      })}</div>
      <div className="scores-week-total" aria-label="Official weekly total"><span>WEEKLY TOTAL</span><strong>{personal.weeklyTotal.toLocaleString()}</strong></div>
      <p className="scores-footnote">Weekly total is the server-calculated sum of your official daily Top 7 results.</p>
    </section> : !leaderboard ? <p className="scores-message" role="status">{leaderboardError ?? "LOADING WORLD PLAYERS…"}</p> : <section className="scores-panel" role="tabpanel">
      <div className="scores-panel__heading"><div><p className="eyebrow">SERVER-VALIDATED TOTALS</p><h2>WORLD PLAYERS</h2></div><span className="scores-game-label">{leaderboard.game.name}</span></div>
      {leaderboard.entries.length === 0 ? <p className="muted">No scores yet</p> : <div className="scores-table scores-table--leaderboard" role="table" aria-label="World players leaderboard">
        <div className="scores-table__header" role="row"><span>POSITION</span><span>PLAYER</span><span>WEEKLY TOTAL</span></div>
        {leaderboard.entries.map((entry) => <div role="row" key={`${entry.rank}-${entry.username}`} className={personal?.rank === entry.rank ? "scores-table__current-player" : undefined}><strong>#{entry.rank}</strong><span>{entry.username}</span><strong>{entry.weeklyTotal.toLocaleString()}</strong></div>)}
      </div>}
      <div className="scores-pagination"><button className="button button--secondary" type="button" disabled={worldPage === 1} onClick={() => changeWorldPage(worldPage - 1)}>PREVIOUS</button><span>PAGE {leaderboard.page}</span><button className="button button--secondary" type="button" disabled={leaderboard.entries.length < leaderboard.pageSize} onClick={() => changeWorldPage(worldPage + 1)}>NEXT</button></div>
      <p className="scores-footnote">Positions and tie-breaks are generated by the server from validated official runs.</p>
    </section>}
  </div>;
}
