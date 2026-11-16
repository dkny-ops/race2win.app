import Link from "next/link";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jumping Race Score", robots: { index: false, follow: false } };

type Ranking = { rank_position: number; player: string; top_1: number; top_2: number; top_3: number; total: number; tied_for_review: boolean };
type Weekly = { score_day: string; daily_top_scores: number[]; daily_total: number; weekly_total: number };
export default async function JumpingRaceScoresPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const requested = Number(params.page ?? 1);
  const page = Number.isSafeInteger(requested) && requested >= 1 && requested <= 200 ? requested : 1;
  const context = await getVerifiedUserContext();
  const signedIn = Boolean(context);
  const db = isAdminConfigured() ? createAdminClient() : null;
  const now = new Date();
  const hour = new Date(Math.floor(now.getTime() / 3600000) * 3600000).toISOString();
  const [enabledResponse, rankingResponse, weeklyResponse, allowanceResponse] = db ? await Promise.all([
    db.rpc("jr_competition_enabled"),
    db.rpc("jr_hourly_leaderboard", { p_hour_started_at: hour, p_offset: (page - 1) * 50, p_limit: 50 }),
    context ? db.rpc("jr_personal_weekly_score", { p_player_id: context.userId }) : Promise.resolve({ data: null, error: null }),
    context ? db.rpc("jr_read_allowance", { p_player_id: context.userId }) : Promise.resolve({ data: null, error: null }),
  ]) : [{ data: false, error: null }, { data: null, error: true }, { data: null, error: true }, { data: null, error: true }];
  const enabled = enabledResponse.data === true;
  const rankings = (rankingResponse.data ?? []) as Ranking[];
  const weekly = (weeklyResponse.data ?? []) as Weekly[];
  const remaining = allowanceResponse.data?.[0]?.plays_remaining;
  const unavailable = Boolean(rankingResponse.error || enabledResponse.error);
  return <section className="page-section scores-page jumping-scores-page"><div className="shell">
    <Link href="/games/jumping-race" className="button button--secondary" style={{ marginBottom: "1.25rem" }}>← BACK TO JUMPING RACE</Link>
    <p className="eyebrow">JUMPING RACE · SCORE</p><h1>WORLD SCORE</h1>
    <p className="page-lede">Hourly verified results · UTC · Top three runs per player</p>
    <section className="scores-panel scores-ranking-panel" aria-labelledby="jumping-score-title">
      <div className="scores-ranking-title"><span className="scores-ranking-symbol" aria-hidden="true">★</span><div><p className="eyebrow">CURRENT HOUR · UTC</p><h2 id="jumping-score-title">WORLD SCORE</h2></div></div>
      <p className="scores-ranking-subtitle">TOP 3 VERIFIED SCORES · HOURLY TOTAL · UTC</p>
      {unavailable ? <p role="status">Score service temporarily unavailable.</p> : !enabled ? <p role="status">Official Jumping Race scoring is not active yet.</p> : rankings.length === 0 ? <p role="status">No verified scores for this hour yet.</p> : null}
      <div className="scores-table scores-ranking-table jumping-scores-table" role="table" aria-label="Jumping Race world score">
        <div className="scores-table__header" role="row"><span role="columnheader">POSITION</span><span role="columnheader">PLAYER</span><span role="columnheader">TOP 1</span><span role="columnheader">TOP 2</span><span role="columnheader">TOP 3</span><span role="columnheader">TOTAL</span></div>
        {rankings.map((r) => <div className="scores-table__row" role="row" key={r.rank_position}>
          <span role="cell">{r.rank_position}{r.tied_for_review ? " *" : ""}</span><span role="cell">{r.player}</span><span role="cell">{r.top_1}</span><span role="cell">{r.top_2}</span><span role="cell">{r.top_3}</span><span role="cell">{r.total}</span>
        </div>)}
      </div>
      {rankings.some(r => r.tied_for_review) && <p>* Complete tie pending manual review.</p>}
      <div className="scores-pagination">
        <Link aria-disabled={page === 1} className="button button--secondary" href={page > 1 ? "?page=" + (page - 1) : "?page=1"}>PREVIOUS</Link>
        <span>PAGE {page}</span>
        {rankings.length === 50 ? <Link className="button button--secondary" href={"?page=" + (page + 1)}>NEXT</Link> : <span>NEXT</span>}
      </div>
    </section>
    {signedIn && <section className="scores-panel" style={{ marginTop: 24 }}>
      <h2>PERSONAL WEEKLY SCORE</h2><p>America/New_York · Best seven verified runs each day</p>
      <p>Weekly total: <strong>{weekly[0]?.weekly_total ?? 0}</strong></p>
      <div className="scores-table" role="table" aria-label="Personal weekly score">
        <div className="scores-table__header" role="row"><span role="columnheader">DAY</span><span role="columnheader">TOP 7</span><span role="columnheader">TOTAL</span></div>
        {weekly.map(d => <div className="scores-table__row" role="row" key={d.score_day}><span role="cell">{d.score_day}</span><span role="cell">{d.daily_top_scores.join(", ") || "—"}</span><span role="cell">{d.daily_total}</span></div>)}
      </div>
    </section>}
    <aside className="jumping-scores-session" aria-live="polite">{signedIn ? "SIGNED IN" + (typeof remaining === "number" ? " · " + remaining + " attempts remaining this UTC hour" : "") : "GUEST MODE · Sign in to participate"}</aside>
  </div></section>;
}
