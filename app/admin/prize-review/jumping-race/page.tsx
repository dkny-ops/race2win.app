import Link from "next/link";
import { notFound } from "next/navigation";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";
import { isUuid } from "@/lib/competition/server";
import { parseFlappyWeek, previousFlappyWeek } from "@/lib/game/flappy/tournament";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { BalanceHistory } from "../balance-history";
import { ReviewControls } from "./review-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Jumping Race", robots: { index: false, follow: false } };

const panel = "/admin/prize-review/jumping-race";
const states: Record<string, string> = {
  pending_review: "Pendiente de revisión",
  needs_additional_review: "Revisión adicional",
  approved: "Aprobado",
  rejected: "Rechazado",
  financial_credit_approved: "Crédito aprobado",
};
const date = (value: string) => new Date(value).toLocaleString("es-US", { timeZone: "America/New_York" });
const cardStyle = { padding: "1.25rem", marginBottom: "1rem", overflowWrap: "anywhere" } as const;

type Player = { user_id: string; username: string | null };
type Run = {
  id: string; started_at: string; status: string; verification_status: string | null;
  gameplay_version: string; score: number | null; elapsed_ms: number | null;
  result_status: string | null; rejection_reason: string | null; review_reason: string | null;
  review_signals: string[] | null; tournament_day: string | null; daily_rank?: number;
};
type Candidate = {
  player_id: string; username: string; weekly_total: number; scores: number[];
  effective_rank: number; state: string; award_status: string | null; amount_cents: number | null;
  events: { id: string; decision: string; note: string; created_at: string }[];
};
type Review = {
  enabled: boolean; inauguralWeek: string | null; frozen: boolean; ties: number;
  candidates: Candidate[]; players: Player[]; player: Player | null; top: Run[]; recent: Run[];
};
type Ranking = {
  entries: { username: string; rank: number | null; weeklyTotal: number; reviewRequired: boolean }[];
};

function RunEvidence({ run }: { run: Run }) {
  return <details>
    <summary>
      {run.daily_rank ? `${run.tournament_day} · #${run.daily_rank} · ` : `${date(run.started_at)} · `}
      {run.score === null ? "Sin puntuación" : `${run.score.toLocaleString("es-US")} puntos`} · {run.result_status ?? run.status}
    </summary>
    <p>Sesión {run.id} · {run.gameplay_version} · Verificación humana: {run.verification_status ?? "Sin datos"}</p>
    {run.elapsed_ms !== null && <p>Duración: {(run.elapsed_ms / 1000).toFixed(2)} s</p>}
    {run.rejection_reason && <p>Rechazo: {run.rejection_reason}</p>}
    {run.review_reason && <p>Motivo de revisión: {run.review_reason}</p>}
    {Array.isArray(run.review_signals) && run.review_signals.length > 0 &&
      <p>Señales: {run.review_signals.join(" · ")}</p>}
  </details>;
}

export default async function JumpingRaceReviewPage({ searchParams }: {
  searchParams: Promise<{ week?: string | string[]; q?: string | string[]; player?: string | string[] }>;
}) {
  const auth = await getAuthorizedPrizeAdmin();
  if (!auth) notFound();

  const filters = await searchParams;
  const week = parseFlappyWeek(filters.week) ?? previousFlappyWeek();
  const search = typeof filters.q === "string" ? filters.q.trim().slice(0, 50) : "";
  const playerId = isUuid(filters.player) ? filters.player : null;
  const [reviewResult, rankingResult] = await Promise.all([
    auth.admin.rpc("jr_admin_read", {
      p_actor: auth.context.userId, p_week: week, p_search: search, p_player: playerId,
    }),
    auth.admin.rpc("jr_weekly_leaderboard", { p_week: week, p_page: 1 }),
  ]);
  if (reviewResult.error || !reviewResult.data || rankingResult.error || !rankingResult.data) {
    throw new Error("No se pudo consultar el panel de Jumping Race.");
  }

  const review: Review = reviewResult.data;
  const ranking: Ranking["entries"] = rankingResult.data.entries;
  const canClose = review.enabled && !review.frozen && review.inauguralWeek &&
    week >= review.inauguralWeek && week < currentNewYorkTournamentWeek();
  const playerLink = (id: string) => `${panel}?${new URLSearchParams({ week, q: search, player: id })}#jugador`;

  return <main className="page-section shell narrow flappy-admin-review">
    <h1 className="flappy-admin-page-title">PANEL DE REVISIÓN SEMANAL · JUMPING RACE</h1>
    <nav className="button-row">
      <Link href="/" className="button button--secondary">← VOLVER A HOME</Link>
      <Link href="/admin/prize-review/auth-401" className="button button--secondary">REVISAR ACCESOS 401 →</Link>
    </nav>
    <form action={panel} className="button-row" style={{ margin: "1rem 0" }}>
      <label>Semana (lunes, Nueva York) <input name="week" type="date" defaultValue={week} required /></label>
      <label>Jugador <input name="q" type="search" defaultValue={search} maxLength={50} placeholder="Usuario o ID" /></label>
      <button className="button button--primary">BUSCAR</button>
    </form>
    {search && <section>
      <h2>Jugadores encontrados</h2>
      {review.players.length ? <ul>{review.players.map(player =>
        <li key={player.user_id}><Link href={playerLink(player.user_id)}>{player.username ?? player.user_id}</Link></li>,
      )}</ul> : <p>No se encontraron jugadores de Jumping Race.</p>}
    </section>}
    {review.player && <section className="profile-card" id="jugador" style={cardStyle}>
      <h2>{review.player.username ?? "Jugador"}</h2>
      <p>{review.player.user_id}</p>
      <BalanceHistory playerId={review.player.user_id} />
      <h3>Top 7 diario de la semana</h3>
      {review.top.length ? review.top.map(run => <RunEvidence key={run.id} run={run} />) : <p>Sin resultados verificados.</p>}
      <h3>Últimas 30 sesiones</h3>
      {review.recent.map(run => <RunEvidence key={run.id} run={run} />)}
    </section>}
    <section className="profile-card" style={cardStyle}>
      <h2>Clasificación oficial de la semana</h2>
      {ranking.length ? <ul>{ranking.map(row =>
        <li key={row.username}>{row.reviewRequired ? "Empate exacto" : `#${row.rank}`} · {row.username} · {row.weeklyTotal.toLocaleString("es-US")} puntos</li>,
      )}</ul> : <p>Sin resultados oficiales para esta semana.</p>}
    </section>
    <section>
      <h2>Expedientes de premios</h2>
      <p>{review.enabled ? (review.frozen ? "Clasificación de premios congelada." : "Semana sin clasificación de premios congelada.") : "Programa de premios desactivado."}</p>
      {canClose && <ReviewControls key={week} week={week} />}
      {review.ties > 0 && <p>Jugadores con empate exacto pendientes de revisión: {review.ties}.</p>}
      {review.candidates.length === 0 && <p>No hay candidatos de premios para esta semana.</p>}
      {review.candidates.map(candidate => <article className="profile-card" key={candidate.player_id} style={cardStyle}>
        <h3>#{candidate.effective_rank} · <Link href={playerLink(candidate.player_id)}>{candidate.username}</Link></h3>
        <p>{candidate.weekly_total.toLocaleString("es-US")} puntos · {states[candidate.state] ?? candidate.state}</p>
        <p>Premio registrado: {candidate.amount_cents === null ? "Sin asignar" :
          `$${(candidate.amount_cents / 100).toFixed(2)} · ${candidate.award_status}`}</p>
        <details><summary>Puntuaciones congeladas</summary><p>{candidate.scores.join(" · ")}</p></details>
        <details><summary>Historial de decisiones</summary>
          {candidate.events.length ? <ul>{candidate.events.map(event =>
            <li key={event.id}>{date(event.created_at)} · {states[event.decision] ?? event.decision} · {event.note}</li>,
          )}</ul> : <p>Sin decisiones registradas.</p>}
        </details>
        {review.enabled && ["pending_review", "needs_additional_review"].includes(candidate.state) &&
          <ReviewControls key={week} week={week} playerId={candidate.player_id} />}
      </article>)}
    </section>
  </main>;
}
