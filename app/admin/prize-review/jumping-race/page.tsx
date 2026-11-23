import Link from "next/link";
import { notFound } from "next/navigation";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";
import { isUuid } from "@/lib/competition/server";
import { parseFlappyWeek, previousFlappyWeek } from "@/lib/game/flappy/tournament";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { BalanceHistory } from "../balance-history";
import { ReviewControls } from "./review-controls";
import { JumpingPrizeControls } from "@/components/game/jumping-prize-controls";
import { CompetitionIdentityEvidence } from "@/components/game/competition-identity-evidence";

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
type Winner = { id: string; player_id: string; status: string; allocation_status: string };

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
    <details style={{ marginTop: ".6rem", paddingLeft: ".25rem" }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>FRAUD &amp; SECURITY · EVIDENCIA DEL SERVIDOR</summary>
      <p>Solo lectura. El servidor conserva la verificación humana vinculada a la sesión, reproduce las acciones y decide si el resultado se publica, se retiene o se rechaza.</p>
      <p><strong>Estado del resultado:</strong> {run.result_status ?? run.status}</p>
      <p><strong>Verificación humana:</strong> {run.verification_status ?? "Sin datos"}</p>
      <p><strong>Señales antifraude:</strong> {Array.isArray(run.review_signals) && run.review_signals.length > 0 ? run.review_signals.join(" · ") : "Ninguna registrada"}</p>
      <p>La semilla, nonces, tokens y acciones crudas no se muestran en el panel.</p>
    </details>
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
  const provisional = review.candidates.length === 0
    ? ranking.filter(entry => typeof entry.rank === "number" && entry.rank >= 1 && entry.rank <= 3).map(entry => ({
      ...entry, player: review.players.find(player => player.username === entry.username) ?? null,
    })) : [];
  const candidateIds = [...review.candidates.map(candidate => candidate.player_id), ...provisional.flatMap(entry => entry.player ? [entry.player.user_id] : [])];
  const gameResult = await auth.admin.from("games").select("id").eq("slug", "jumping-race").maybeSingle();
  if (gameResult.error || !gameResult.data) throw new Error("Jumping Race no está disponible.");
  const [balancesResult, winnersResult, flagsResult] = candidateIds.length ? await Promise.all([
    auth.admin.from("prize_balances").select("player_id,available_cents").in("player_id", candidateIds),
    auth.admin.from("provisional_winners").select("id,player_id,status,allocation_status").eq("game_id", gameResult.data.id).eq("tournament_week_start", week).eq("award_type", "weekly_tournament"),
    auth.admin.from("fraud_flags").select("player_id").eq("game_id", gameResult.data.id).in("player_id", candidateIds).in("status", ["open", "under_review", "confirmed"]),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (balancesResult.error || winnersResult.error || flagsResult.error) throw new Error("No se pudo consultar el estado financiero.");
  const balances = new Map((balancesResult.data ?? []).map(row => [row.player_id, row.available_cents]));
  const winners = new Map(((winnersResult.data ?? []) as Winner[]).map(row => [row.player_id, row]));
  const flagCounts = new Map<string, number>();
  for (const flag of flagsResult.data ?? []) flagCounts.set(flag.player_id, (flagCounts.get(flag.player_id) ?? 0) + 1);
  const canClose = review.enabled && !review.frozen && review.inauguralWeek &&
    week >= review.inauguralWeek && week < currentNewYorkTournamentWeek();
  const playerLink = (id: string) => `${panel}?${new URLSearchParams({ week, q: search, player: id })}#jugador`;

  return <main className="page-section shell narrow flappy-admin-review">
    <h1 className="flappy-admin-page-title">PANEL DE REVISIÓN SEMANAL · JUMPING RACE</h1>
    <nav className="button-row" style={{ marginBottom: "1.25rem" }}>
      <Link href="/admin/prize-review/auth-401" className="button button--secondary">REVISAR ACCESOS 401 →</Link>
      <Link href="/" className="button button--secondary">← VOLVER A HOME</Link>
      <Link href="#buscar-jugador" className="button button--primary">BUSCAR JUGADOR →</Link>
    </nav>
    <form id="buscar-jugador" action={panel} className="button-row" style={{ margin: "1rem 0" }}>
      <label>Semana (lunes, Nueva York) <input name="week" type="date" defaultValue={week} required /></label>
      <label>Jugador <input name="q" type="search" defaultValue={search} maxLength={50} placeholder="Usuario o ID" /></label>
      <button className="button button--primary">BUSCAR</button>
    </form>
    <p>Ganadores de la semana del {week}. Las decisiones requieren revisión humana; Jumping Race mantiene su propio programa de premios y sus controles independientes.</p>
    <section>
      <h2>Expedientes de premios</h2>
      <p>{review.enabled ? (review.frozen ? "Clasificación de premios congelada." : "Semana sin clasificación de premios congelada.") : "Programa de premios desactivado."}</p>
      {!review.enabled && <JumpingPrizeControls enabled={false} week={week} />}
      {canClose && <ReviewControls key={week} week={week} />}
      {review.ties > 0 && <p>Jugadores con empate exacto pendientes de revisión: {review.ties}.</p>}
      {review.candidates.length === 0 && <><h2>CLASIFICACIÓN PROVISIONAL DE LA SEMANA</h2><p>Estos son los tres primeros del ranking verificado. No son premios ni se pueden acreditar hasta que el programa esté activo desde el período correspondiente y la semana se cierre de forma segura.</p>
        {provisional.length === 0 ? <p>No hay candidatos de premios para esta semana.</p> : provisional.map(entry => <article className="profile-card" key={entry.username} style={{ ...cardStyle, border: "1px solid rgba(110,255,173,.3)", borderRadius: 14 }}>
          <h2 style={{ fontSize: "clamp(1.4rem,5vw,2.3rem)" }}>#{entry.rank} · {entry.username}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: ".75rem" }}>
            <div className="profile-card" style={cardStyle}><small>TOTAL SEMANAL</small><h3>{entry.weeklyTotal.toLocaleString("en-US")}</h3></div>
            <div className="profile-card" style={cardStyle}><small>PREMIO PROVISIONAL</small><h3>{entry.rank === 1 ? "$5.00" : entry.rank === 2 ? "$3.00" : "$2.00"}</h3></div>
            <div className="profile-card" style={cardStyle}><small>ALERTAS ABIERTAS</small><h3>{entry.player ? flagCounts.get(entry.player.user_id) ?? 0 : "—"}</h3></div>
            <div className="profile-card" style={cardStyle}><small>ESTADO</small><h3>{entry.reviewRequired ? "EMPATE · REVISIÓN" : "PENDIENTE DE ELEGIBILIDAD"}</h3></div>
          </div>
          {entry.player ? <><BalanceHistory playerId={entry.player.user_id} /><CompetitionIdentityEvidence actor={auth.context.userId} player={entry.player.user_id} week={week} /><Link href={playerLink(entry.player.user_id)}>VER PARTIDAS Y EVIDENCIA →</Link></> : <p>No se habilitan acciones: no se encontró una identidad única para esta clasificación.</p>}
        </article>)}</>}
      {review.candidates.map(candidate => <article className="profile-card" key={candidate.player_id} style={{ ...cardStyle, border: "1px solid rgba(110,255,173,.3)", borderRadius: 14 }}>
        <h2 style={{ fontSize: "clamp(1.4rem,5vw,2.3rem)" }}>#{candidate.effective_rank} · {candidate.username}</h2>
        <p>ID de jugador: {candidate.player_id.slice(0,8)}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: ".75rem" }}>
          <div className="profile-card" style={cardStyle}><small>TOTAL SEMANAL</small><h3>{candidate.weekly_total.toLocaleString("es-US")}</h3></div>
          <div className="profile-card" style={cardStyle}><small>PREMIO PROVISIONAL</small><h3>{candidate.amount_cents === null ? "No asignado" : `$${(candidate.amount_cents / 100).toFixed(2)}`}</h3></div>
          <div className="profile-card" style={cardStyle}><small>ESTADO DEL PREMIO</small><h3>{candidate.award_status ?? "No asignado"}</h3></div>
        </div>
        <p>Estado del candidato: {states[candidate.state] ?? candidate.state}</p>
        <BalanceHistory playerId={candidate.player_id} />
        <CompetitionIdentityEvidence actor={auth.context.userId} player={candidate.player_id} week={week} />
        <h3>VERIFICACIÓN Y PREMIOS</h3>
        <p>Estado: {states[candidate.state] ?? candidate.state}</p>
        <p>La revisión de Jumping Race utiliza decisiones auditadas. La verificación por correo y la acreditación financiera de Flappy Race no se aplican automáticamente a este juego.</p>
        {review.enabled && ["pending_review", "needs_additional_review"].includes(candidate.state) &&
          <ReviewControls key={candidate.player_id} week={week} playerId={candidate.player_id} />}
        {review.enabled && <JumpingPrizeControls
          enabled={true}
          week={week}
          playerId={candidate.player_id}
          state={candidate.state}
          balanceCents={balances.get(candidate.player_id) ?? 0}
          winnerId={winners.get(candidate.player_id)?.id}
          credited={winners.get(candidate.player_id)?.status === "approved_for_payment" && winners.get(candidate.player_id)?.allocation_status === "allocated"}
        />}
        <details><summary>Historial de decisiones del expediente semanal</summary>
          {candidate.events.length ? candidate.events.map(event => <p key={event.id}>{date(event.created_at)} · {states[event.decision] ?? event.decision} · {event.note}</p>) : <p>Sin decisiones registradas.</p>}
        </details>
        <details><summary>Ver puntuaciones clasificadas</summary><p>{candidate.scores.length ? candidate.scores.join(" · ") : "Sin puntuaciones registradas."}</p></details>
        <details><summary>Ver Top 7 de cada día</summary><p>Consulta el historial de partidas verificadas del jugador.</p><Link href={playerLink(candidate.player_id)}>ABRIR HISTORIAL DEL JUGADOR →</Link></details>
        <details><summary>Historial y datos de revisión</summary><p>ID: {candidate.player_id}</p><p>Estado: {states[candidate.state] ?? candidate.state}</p><p>Premio: {candidate.award_status ?? "No asignado"}</p></details>
      </article>)}
    </section>
    <section>
      <h2>Jugadores de Jumping Race</h2>
      {review.players.length ? <ul>{review.players.map(player =>
        <li key={player.user_id}><Link href={playerLink(player.user_id)}>{player.username ?? player.user_id}</Link></li>,
      )}</ul> : <p>No se encontraron jugadores de Jumping Race.</p>}
    </section>
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
  </main>;
}
