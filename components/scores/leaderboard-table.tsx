"use client";
import { useEffect, useState } from "react";
type Entry = { rank: number; username: string; weeklyTotal: number };
type Board = { game: { name: string }; tournamentWeek: string; page: number; hasNextPage: boolean; entries: Entry[] };
export function LeaderboardTable() {
  const [data, setData] = useState<Board | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/leaderboard?page=${page}&pageSize=50`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Unavailable");
      const body = await response.json() as Board;
      if (!controller.signal.aborted) setData(body);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [page]);
  function changePage(next: number) { setData(null); setError(false); setPage(next); }
  if (error) return <p className="scores-message" role="status">The leaderboard is temporarily unavailable.</p>;
  if (!data) return <p className="scores-message" role="status">LOADING LEADERBOARD…</p>;
  return <section className="scores-panel scores-panel--leaderboard"><div className="scores-panel__heading"><div><p className="eyebrow">CURRENT TOURNAMENT WEEK</p><h2>{data.tournamentWeek}</h2></div><span className="scores-game-label">{data.game.name} · TOP 7 / DAY</span></div>
    {data.entries.length === 0 ? <p className="muted">No public ranked scores for this week yet.</p> : <div className="scores-table scores-table--leaderboard" role="table" aria-label="Race To Win weekly leaderboard"><div className="scores-table__header" role="row"><span role="columnheader">POSITION</span><span role="columnheader">RACER</span><span role="columnheader">WEEKLY TOTAL</span></div>{data.entries.map((entry) => <div className={`scores-table__row ranking-row${entry.rank <= 3 ? ` ranking-row--${entry.rank}` : ""}`} role="row" key={entry.rank}><strong role="cell" aria-label={`Position ${entry.rank}`}>{entry.rank <= 3 ? <span aria-hidden="true" className={`ranking-medal ranking-medal--${entry.rank}`}>{entry.rank === 1 ? "🏆" : entry.rank === 2 ? "🥈" : "🥉"}</span> : null}<span>#{entry.rank}</span></strong><span role="cell">{entry.username}</span><strong role="cell">{entry.weeklyTotal.toLocaleString()}</strong></div>)}</div>}
    <div className="scores-pagination"><button className="button button--secondary" type="button" disabled={page === 1} onClick={() => changePage(page - 1)}>PREVIOUS</button><span aria-live="polite">PAGE {data.page}</span><button className="button button--secondary" type="button" disabled={!data.hasNextPage} onClick={() => changePage(page + 1)}>NEXT</button></div>
  </section>;
}
