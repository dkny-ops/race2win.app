import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/routes";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin Prize Review", robots: { index: false, follow: false } };

function money(value: number | null) {
  return typeof value === "number" ? "$" + (value / 100).toFixed(2) : "Not allocated";
}

export default async function AdminPrizeReviewPage() {
  const context = await getVerifiedUserContext();
  if (!context) redirect(ROUTES.signIn);
  const admin = createAdminClient();
  const { data: authorized, error: gateError } = await admin.rpc("rtw_server_is_active_admin", {
    p_actor_user_id: context.userId,
  });
  if (gateError || authorized !== true) notFound();

  const week = currentNewYorkTournamentWeek();
  const monday = new Date(week + "T12:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - 7);
  const previousWeek = monday.toISOString().slice(0, 10);

  const { data: game, error: gameError } = await admin.from("games")
    .select("id").eq("slug", "race-to-win").maybeSingle();
  if (gameError || !game) throw new Error("Prize review unavailable");

  const [totals, winners, runs, flags, payouts] = await Promise.all([
    admin.from("weekly_tournament_totals")
      .select("player_id,rank_position,weekly_total_score,tie_break_status")
      .eq("game_id", game.id).eq("tournament_week_start", previousWeek)
      .lte("rank_position", 3).order("rank_position"),
    admin.from("provisional_winners")
      .select("id,player_id,rank_position,amount_cents,status,allocation_status,award_type")
      .eq("game_id", game.id).eq("tournament_week_start", previousWeek),
    admin.from("validated_runs")
      .select("player_id,score,elapsed_ms,distance_millimeters,eligibility_status,game_session_id")
      .eq("game_id", game.id).eq("tournament_week_start", previousWeek)
      .order("score", { ascending: false }).limit(300),
    admin.from("fraud_flags")
      .select("player_id,severity,status,signal_summary")
      .eq("game_id", game.id).neq("status", "resolved").limit(300),
    admin.from("payouts")
      .select("id,player_id,amount_cents,status,requested_at")
      .in("status", ["requested", "under_review", "approved"])
      .order("requested_at", { ascending: false }).limit(50),
  ]);
  if (totals.error || winners.error || runs.error || flags.error || payouts.error) throw new Error("Prize review unavailable");

  return <section className="page-section shell narrow">
    <p className="eyebrow">OWNER REVIEW · READ ONLY</p>
    <h1>Weekly prize review</h1>
    <p>Week beginning {previousWeek}. No payments, approvals or wallet credits can be triggered from this page.</p>
    {(totals.data ?? []).length === 0 ? <p>No ranked players for this week.</p> : (totals.data ?? []).map((entry) => {
      const winner = (winners.data ?? []).find((w) => w.player_id === entry.player_id && w.award_type === "weekly_tournament");
      const playerRuns = (runs.data ?? []).filter((run) => run.player_id === entry.player_id);
      const playerFlags = (flags.data ?? []).filter((flag) => flag.player_id === entry.player_id);
      const name = "Player " + entry.player_id.slice(0, 8);
      return <article className="profile-card" key={entry.player_id} style={{ marginTop: "1rem" }}>
        <h2>#{entry.rank_position} · {name}</h2>
        <p>Weekly score: {entry.weekly_total_score} · Tie: {entry.tie_break_status}</p>
        <p>Prize: {money(winner?.amount_cents ?? null)} · Status: {winner?.status ?? "Not generated"}</p>
        <p>Unresolved fraud flags: {playerFlags.length}</p>
        {playerFlags.map((flag, index) => <p key={index}>{flag.severity} · {flag.status} · {flag.signal_summary}</p>)}
        <h3>Recorded runs (up to 300 per week)</h3>
        <ul>{playerRuns.map((run) => <li key={run.game_session_id}>
          Score {run.score} · {run.elapsed_ms} ms · {run.eligibility_status} · Session {run.game_session_id}
        </li>)}</ul>
      </article>;
    })}
    <h2>Open payout requests (up to 50)</h2>
    {(payouts.data ?? []).length === 0 ? <p>No open payout requests.</p> : <ul>{(payouts.data ?? []).map((payout) => <li key={payout.id}>
      Player {payout.player_id.slice(0, 8)} · {money(payout.amount_cents)} · {payout.status} · Request {payout.id}
    </li>)}</ul>}
    <p>Requests shown here are not proof of eligibility or authorization to pay. Verify each request before manually paying.</p>
    <p><Link href={ROUTES.home}>Back to home</Link></p>
  </section>;
}
