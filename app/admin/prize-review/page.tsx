import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { notFound } from "next/navigation";
import { PayoutEmailReview } from "./payout-email-review";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin Prize Review", robots: { index: false, follow: false } };

function money(value: number | null) {
  return typeof value === "number" ? "$" + (value / 100).toFixed(2) : "Not allocated";
}

export default async function AdminPrizeReviewPage() {
  const authorization = await getAuthorizedPrizeAdmin();
  if (!authorization) notFound();
  const { admin } = authorization;

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
    admin.from("daily_top_scores")
      .select("player_id,tournament_day,daily_rank,validated_run_id,score")
      .eq("game_id", game.id).eq("tournament_week_start", previousWeek)
      .lte("daily_rank", 7)
      .order("tournament_day", { ascending: true })
      .order("daily_rank", { ascending: true }).limit(1000),
    admin.from("fraud_flags")
      .select("player_id,severity,status,signal_summary")
      .eq("game_id", game.id).neq("status", "resolved").limit(300),
    admin.from("payouts")
      .select("id,player_id,amount_cents,status,requested_at")
      .in("status", ["requested", "under_review", "approved"])
      .order("requested_at", { ascending: false }).limit(50),
  ]);
  if (totals.error || winners.error || runs.error || flags.error || payouts.error) throw new Error("Prize review unavailable");

  const winnersTop = totals.data ?? [];
  const winnerIds = winnersTop.map((entry) => entry.player_id);
  const dailyTop = (runs.data ?? []).filter((run) => winnerIds.includes(run.player_id));
  const runIds = dailyTop.map((run) => run.validated_run_id);
  const [profilesResponse, runDetailsResponse] = await Promise.all([
    winnerIds.length ? admin.from("profiles").select("user_id,username").in("user_id", winnerIds) : Promise.resolve({ data: [], error: null }),
    runIds.length ? admin.from("validated_runs").select("id,game_session_id,elapsed_ms,distance_millimeters,completed_at,eligibility_status").in("id", runIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesResponse.error || runDetailsResponse.error) throw new Error("Player summary unavailable");
  const playerNames = new Map((profilesResponse.data ?? []).map((profile) => [profile.user_id, profile.username]));
  const runDetails = new Map((runDetailsResponse.data ?? []).map((run) => [run.id, run]));
  const formatTime = (value: string | null | undefined) => value
    ? new Intl.DateTimeFormat("es-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" }).format(new Date(value))
    : "—";
  const formatDuration = (milliseconds: number | null | undefined) => {
    if (milliseconds == null) return "—";
    const seconds = Math.floor(milliseconds / 1000);
    return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  };

  return <section className="page-section shell narrow">
    <p className="eyebrow">OWNER REVIEW · READ ONLY</p>
    <h1>Weekly prize review</h1>
    <p>Week beginning {previousWeek}. Email-code generation and owner attestation are available; no payments, approvals or wallet credits can be triggered from this page.</p>
    {(totals.data ?? []).length === 0 ? <p>No ranked players for this week.</p> : (totals.data ?? []).map((entry) => {
      const winner = (winners.data ?? []).find((w) => w.player_id === entry.player_id && w.award_type === "weekly_tournament");
      const playerRuns = dailyTop.filter((run) => run.player_id === entry.player_id);
      const playerFlags = (flags.data ?? []).filter((flag) => flag.player_id === entry.player_id);
      const name = playerNames.get(entry.player_id) || "Jugador " + entry.player_id.slice(0, 8);
      return <article className="profile-card" key={entry.player_id} style={{ marginTop: "1rem" }}>
        <h2>#{entry.rank_position} · {name}</h2>
        <p>Weekly score: {entry.weekly_total_score} · Tie: {entry.tie_break_status}</p>
        <p>Prize: {money(winner?.amount_cents ?? null)} · Status: {winner?.status ?? "Not generated"}</p>
        <p>Unresolved fraud flags: {playerFlags.length}</p>
        {playerFlags.map((flag, index) => <p key={index}>{flag.severity} · {flag.status} · {flag.signal_summary}</p>)}
        <p><strong>ID jugador:</strong> <code>{entry.player_id}</code></p>
        <h3>Top 7 de cada día</h3>
        <p>Solo partidas que cuentan en la clasificación diaria. Hora de Nueva York.</p>
        <div style={{ overflowX: "auto", maxWidth: "100%" }}>
          <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead><tr>{["Día", "Puesto", "Puntos", "Duración", "Distancia (m)", "Finalización (NY)", "ID partida"].map((label) =>
              <th key={label} scope="col" style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #777", whiteSpace: "nowrap" }}>{label}</th>
            )}</tr></thead>
            <tbody>{playerRuns.length ? playerRuns.map((run) => {
              const details = runDetails.get(run.validated_run_id);
              return <tr key={run.validated_run_id}>
                <td style={{ padding: 8, borderBottom: "1px solid #555" }}>{run.tournament_day}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #555" }}>#{run.daily_rank}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #555" }}>{run.score.toLocaleString("en-US")}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #555" }}>{formatDuration(details?.elapsed_ms)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #555" }}>{details ? (Number(details.distance_millimeters) / 1000).toFixed(2) : "—"}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #555", whiteSpace: "nowrap" }}>{formatTime(details?.completed_at)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #555" }}><code>{details?.game_session_id ?? run.validated_run_id}</code></td>
              </tr>;
            }) : <tr><td colSpan={7} style={{ padding: 8 }}>No hay puntuaciones Top 7 registradas.</td></tr>}</tbody>
          </table>
        </div>
        <p><strong>Total de partidas Top 7:</strong> {playerRuns.length} · <strong>Total semanal:</strong> {entry.weekly_total_score.toLocaleString("en-US")}</p>
      </article>;
    })}
    <h2>Open payout requests (up to 50)</h2>
    <PayoutEmailReview requests={(payouts.data ?? []).map((p) => ({
      id: p.id, playerId: p.player_id, amountCents: p.amount_cents, status: p.status,
    }))} />
    <p>Requests shown here are not proof of eligibility or authorization to pay. Verify each request before manually paying.</p>
    <p><Link href={ROUTES.home}>Back to home</Link></p>
  </section>;
}
