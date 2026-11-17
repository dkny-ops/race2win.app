import Link from "next/link";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jumping Race Weekly Leaderboard", robots: { index: false, follow: false } };

type Ranking = { rank: number | null; username: string; weeklyTotal: number; reviewRequired: boolean };
type Weekly = { score_day: string; daily_top_scores: number[]; daily_total: number; weekly_total: number };
export default async function JumpingRaceScoresPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const requested = Number(params.page ?? 1);
  const page = Number.isSafeInteger(requested) && requested >= 1 && requested <= 200 ? requested : 1;
  const context = await getVerifiedUserContext();
  const signedIn = Boolean(context);
  const db = isAdminConfigured() ? createAdminClient() : null;
  const now = new Date();
  const todayNY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const day = new Date(todayNY + "T12:00:00Z");
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  const week = day.toISOString().slice(0, 10);
  const [enabledResponse, rankingResponse, weeklyResponse] = db ? await Promise.all([
    db.rpc("jr_competition_enabled"),
    db.rpc("jr_weekly_leaderboard", { p_week: week, p_page: page }),
    context ? db.rpc("jr_personal_weekly_score", { p_player_id: context.userId }) : Promise.resolve({ data: null, error: null }),
  ]) : [{ data: false, error: null }, { data: null, error: true }, { data: null, error: true }];
  const enabled = enabledResponse.data === true;
  const rankings = (rankingResponse.data?.entries ?? []) as Ranking[];
  const hasNextPage = rankingResponse.data?.hasNextPage === true;
  const weekly = (weeklyResponse.data ?? []) as Weekly[];
  const unavailable = Boolean(rankingResponse.error || enabledResponse.error);
  return <section className="page-section scores-page jumping-scores-page"><div className="shell">
    <Link href="/games/jumping-race" className="button button--secondary" style={{ marginBottom: "1.25rem" }}>← BACK TO JUMPING RACE</Link>
    <p className="eyebrow">JUMPING RACE · SCORE</p><h1>LEADERBOARD</h1>
    <section id="leaderboard" className="scores-panel scores-ranking-panel" aria-labelledby="jumping-score-title">
      <div className="scores-ranking-title"><span className="scores-ranking-symbol" aria-hidden="true">★</span><div><p className="eyebrow">CURRENT WEEK · NEW YORK</p><h2 id="jumping-score-title">WORLD SCORE</h2></div></div>
      <p className="scores-ranking-subtitle">TOP 7 VERIFIED RUNS EACH DAY · WEEKLY TOTAL</p>
      {unavailable ? <p role="status">Score service temporarily unavailable.</p> : !enabled ? <p role="status">Official Jumping Race scoring is not active yet.</p> : rankings.length === 0 ? <p role="status">No verified scores for this week yet.</p> : null}
      <div className="scores-table scores-ranking-table jumping-scores-table" role="table" aria-label="Jumping Race world score">
        <div className="scores-table__header" role="row"><span role="columnheader">RANK</span><span role="columnheader">PLAYER</span><span role="columnheader">SCORE</span></div>
        {rankings.map((r) => <div className="scores-table__row" role="row" key={r.username}>
          <span role="cell">{r.reviewRequired ? "Review" : "#" + r.rank}</span><span role="cell">{r.username}</span><span role="cell">{r.weeklyTotal}</span>
        </div>)}
      </div>
      {rankings.some(r => r.reviewRequired) && <p>* Complete tie pending manual review.</p>}
      <div className="scores-pagination">
        <Link aria-disabled={page === 1} className="button button--secondary" href={page > 1 ? "?page=" + (page - 1) : "?page=1"}>PREVIOUS</Link>
        <span>PAGE {page}</span>
        {hasNextPage ? <Link className="button button--secondary" href={"?page=" + (page + 1)}>NEXT</Link> : <span>NEXT</span>}
      </div>
    </section>
    {signedIn && <section id="weekly" className="scores-panel" style={{ marginTop: 24 }}>
      <h2>PERSONAL SCORE</h2>
      <p>Weekly total: <strong>{weekly[0]?.weekly_total ?? 0}</strong></p>
      <div className="scores-table" role="table" aria-label="Personal weekly score">
        <div className="scores-table__header" role="row"><span role="columnheader">DAY</span><span role="columnheader">TOP 7</span><span role="columnheader">TOTAL</span></div>
        {weekly.map(d => <div className="scores-table__row" role="row" key={d.score_day}><span role="cell">{d.score_day}</span><span role="cell">{d.daily_top_scores.join(", ") || "—"}</span><span role="cell">{d.daily_total}</span></div>)}
      </div>
    </section>}
  </div></section>;
}
