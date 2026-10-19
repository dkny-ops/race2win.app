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

  // Read-only enrichment: player names and authoritative session timestamps.
  const runRows = runs.data ?? [];
  const playerIds = [...new Set([
    ...runRows.map((r) => r.player_id),
    ...(totals.data ?? []).map((r) => r.player_id),
    ...(payouts.data ?? []).map((r) => r.player_id),
  ])];
  const sessionIds = [...new Set(runRows.map((r) => r.game_session_id))];
  const [profilesResult, sessionsResult] = await Promise.all([
    playerIds.length ? admin.from("profiles").select("user_id,username").in("user_id", playerIds) : Promise.resolve({ data: [], error: null }),
    sessionIds.length ? admin.from("game_sessions").select("id,started_at,finalized_at,status,anti_fraud_status").in("id", sessionIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesResult.error || sessionsResult.error) throw new Error("Player details unavailable");
  const playerNames = new Map((profilesResult.data ?? []).map((p) => [p.user_id, p.username]));
  const sessions = new Map((sessionsResult.data ?? []).map((session) => [session.id, session]));
  const formatDate = (date: string | null | undefined) => date
    ? new Intl.DateTimeFormat("es-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "medium" }).format(new Date(date))
    : "—";
  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  };
  const shortId = (id: string) => id.slice(0, 8);


  return <section className="page-section shell narrow">
    <p className="eyebrow">OWNER REVIEW · READ ONLY</p>
    <h1>Weekly prize review</h1>
    <p>Week beginning {previousWeek}. Email-code generation and owner attestation are available; no payments, approvals or wallet credits can be triggered from this page.</p>
    {(totals.data ?? []).length === 0 ? <p>No ranked players for this week.</p> : (totals.data ?? []).map((entry) => {
      const winner = (winners.data ?? []).find((w) => w.player_id === entry.player_id && w.award_type === "weekly_tournament");
      const playerRuns = (runs.data ?? []).filter((run) => run.player_id === entry.player_id);
      const playerFlags = (flags.data ?? []).filter((flag) => flag.player_id === entry.player_id);
      const name = playerNames.get(entry.player_id) || "Jugador " + shortId(entry.player_id);
      return <article className="profile-card" key={entry.player_id} style={{ marginTop: "1rem" }}>
        <h2>#{entry.rank_position} · {name}</h2>
        <p>Weekly score: {entry.weekly_total_score} · Tie: {entry.tie_break_status}</p>
        <p>Prize: {money(winner?.amount_cents ?? null)} · Status: {winner?.status ?? "Not generated"}</p>
        <p>Unresolved fraud flags: {playerFlags.length}</p>
        {playerFlags.map((flag, index) => <p key={index}>{flag.severity} · {flag.status} · {flag.signal_summary}</p>)}
        <p>Partidas registradas: {playerRuns.length} (máximo 300 consultadas en la semana)</p>
      </article>;
    })}
    <h2>Detalle de partidas verificadas</h2>
    <p>Tabla de consulta · Horario de Nueva York · Hasta 300 partidas de la semana anterior. Desliza horizontalmente para ver todas las columnas.</p>
    <div style={{ overflowX: "auto", maxWidth: "100%", border: "1px solid #555", borderRadius: 8, marginBottom: "2rem" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1400, fontSize: "0.85rem" }}>
        <thead><tr>{["Jugador ID", "Nombre", "Partida ID", "Inicio (NY)", "Final (NY)", "Puntos", "Duración", "Distancia (m)", "Vida extra", "Multiplicador", "Validación", "Sesión", "Antifraude"].map((heading) =>
          <th key={heading} scope="col" style={{ padding: "0.75rem", borderBottom: "1px solid #888", textAlign: "left", whiteSpace: "nowrap" }}>{heading}</th>
        )}</tr></thead>
        <tbody>{runRows.length === 0 ? <tr><td colSpan={13} style={{ padding: "1rem" }}>No hay partidas registradas en este período.</td></tr> :
          runRows.map((run, index) => {
            const session = sessions.get(run.game_session_id);
            const cells = [
              run.player_id, playerNames.get(run.player_id) || "Sin nombre",
              run.game_session_id, formatDate(session?.started_at), formatDate(session?.finalized_at),
              run.score.toLocaleString("en-US"), formatDuration(run.elapsed_ms),
              (Number(run.distance_millimeters) / 1000).toFixed(2),
              run.extra_life_used ? "Sí" : "No", "×" + run.score_multiplier,
              run.eligibility_status, session?.status || "—", session?.anti_fraud_status || "—",
            ];
            return <tr key={run.game_session_id} style={{ background: index % 2 ? "rgba(128,128,128,0.09)" : "transparent" }}>
              {cells.map((value, i) => <td key={i} style={{ padding: "0.65rem", borderBottom: "1px solid rgba(128,128,128,0.3)", whiteSpace: "nowrap", fontFamily: i === 0 || i === 2 ? "monospace" : undefined }}>{value}</td>)}
            </tr>;
          })
        }</tbody>
      </table>
    </div>
    <p><strong>Columnas:</strong> Jugador ID identifica la cuenta; Partida ID identifica la sesión; Inicio/Final son marcas del servidor; Duración muestra mm:ss; Distancia está en metros; Validación y Antifraude son estados registrados, no decisiones del panel.</p>
    <h2>Open payout requests (up to 50)</h2>
    <PayoutEmailReview requests={(payouts.data ?? []).map((p) => ({
      id: p.id, playerId: p.player_id, amountCents: p.amount_cents, status: p.status,
    }))} />
    <p>Requests shown here are not proof of eligibility or authorization to pay. Verify each request before manually paying.</p>
    <p><Link href={ROUTES.home}>Back to home</Link></p>
  </section>;
}
