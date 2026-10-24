import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { notFound } from "next/navigation";
import { OwnerEmailCode } from "./owner-email-code";
import { BlockPlayerControl } from "./block-player-control";
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

  const [totals, winners, flags, payouts] = await Promise.all([
    admin.from("weekly_tournament_totals")
      .select("player_id,rank_position,weekly_total_score,tie_break_status")
      .eq("game_id", game.id).eq("tournament_week_start", previousWeek)
      .lte("rank_position", 3).order("rank_position"),
    admin.from("provisional_winners")
      .select("id,player_id,rank_position,amount_cents,status,allocation_status,award_type")
      .eq("game_id", game.id).eq("tournament_week_start", previousWeek),
    admin.from("fraud_flags")
      .select("player_id,severity,status,signal_summary")
      .eq("game_id", game.id).neq("status", "resolved").limit(300),
    admin.from("payouts")
      .select("id,player_id,amount_cents,status,requested_at")
      .in("status", ["requested", "under_review", "approved"])
      .order("requested_at", { ascending: false }).limit(50),
  ]);
  if (totals.error || winners.error || flags.error || payouts.error) throw new Error("Prize review unavailable");

  // Read only the server-maintained daily top-seven results; never query all attempts.
  // A failure here must not take down the working prize-review panel.
  const dailyTopResult = await admin.from("daily_top_scores")
    .select("player_id,tournament_day,daily_rank,score,validated_run_id")
    .eq("game_id", game.id)
    .eq("tournament_week_start", previousWeek)
    .lte("daily_rank", 7)
    .order("tournament_day", { ascending: true })
    .order("daily_rank", { ascending: true })
    .limit(500);
  const dailyTopScores = dailyTopResult.error ? null : (dailyTopResult.data ?? []);

  // Only ranked players (up to three) belong to this weekly winner review.
  const ranked = (totals.data ?? []).filter((entry) => entry.rank_position >= 1 && entry.rank_position <= 3);
  const playerIds = ranked.map((entry) => entry.player_id);
  // Fetch each winner's profile independently; a missing profile must not hide others.
  const identitiesList = await Promise.all(playerIds.map(async (id) => {
    const [profileResult, authResult] = await Promise.all([
      admin.from("profiles").select("username").eq("user_id", id).maybeSingle(),
      admin.auth.admin.getUserById(id),
    ]);
    const user = authResult.error ? null : authResult.data.user;
    const metadata = user?.user_metadata;
    const metadataName = typeof metadata?.username === "string" ? metadata.username.trim() : "";
    const profileName = typeof profileResult.data?.username === "string" ? profileResult.data.username.trim() : "";
    return {
      id,
      username: profileName || metadataName || null,
      email: user?.email_confirmed_at ? user.email ?? null : null,
    };
  }));
  const identities = new Map(identitiesList.map((entry) => [entry.id, entry]));

  return <section className="page-section shell narrow">
    <p className="eyebrow">OWNER REVIEW · READ ONLY</p>
    <h1>Panel de revisión semanal</h1>
    <div className="button-row" style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>
      <Link className="button button--primary" href="/admin/prize-review/auth-401">REVISAR ACCESOS 401 →</Link>
      <Link className="button button--primary" href="/admin/prize-review/players">VER JUGADORES →</Link>
    </div>
    <p>Semana del {previousWeek} · Resumen de ganadores y premios. Solo lectura: este panel no ejecuta pagos ni modifica balances.</p>
    {(totals.data ?? []).length === 0 ? <p>No ranked players for this week.</p> : (totals.data ?? []).map((entry) => {
      const winner = (winners.data ?? []).find((w) => w.player_id === entry.player_id && w.award_type === "weekly_tournament");
      const playerFlags = (flags.data ?? []).filter((flag) => flag.player_id === entry.player_id);
      const name = identities.get(entry.player_id)?.username || "Usuario no disponible";
      const scheduledPrizeCents = entry.rank_position === 1 ? 1500 : entry.rank_position === 2 ? 300 : 200;
      return <article className="profile-card" key={entry.player_id} style={{ marginTop: "1rem", padding: "1.25rem", border: "1px solid rgba(255,255,255,.2)", borderRadius: 14 }}>
        <h2 style={{ marginBottom: "0.35rem" }}>#{entry.rank_position} · {name}</h2>
        <p style={{ opacity: 0.75, fontSize: "0.85rem", marginBottom: "1rem" }}>ID de jugador (abreviado): {entry.player_id.slice(0, 8)} · Identificador de cuenta, no puntuación</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
          <div style={{ padding: "0.85rem", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10 }}>
            <p style={{ opacity: 0.7, fontSize: "0.8rem" }}>TOTAL SEMANAL</p>
            <p style={{ fontWeight: 800, fontSize: "1.35rem" }}>{entry.weekly_total_score.toLocaleString("en-US")}</p>
          </div>
          <div style={{ padding: "0.85rem", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10 }}>
            <p style={{ opacity: 0.7, fontSize: "0.8rem" }}>PREMIO PROVISIONAL</p>
            <p style={{ fontWeight: 800, fontSize: "1.35rem" }}>{money(winner?.amount_cents ?? scheduledPrizeCents)}</p>
          </div>
          <div style={{ padding: "0.85rem", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10 }}>
            <p style={{ opacity: 0.7, fontSize: "0.8rem" }}>ALERTAS ABIERTAS</p>
            <p style={{ fontWeight: 800, fontSize: "1.35rem" }}>{playerFlags.length}</p>
          </div>
        </div>
        <h3 style={{ fontSize: "1rem" }}>Acciones del propietario</h3>
        <p></p>
        <OwnerEmailCode playerId={entry.player_id} winnerId={winner?.id} />
        <BlockPlayerControl playerId={entry.player_id} username={name} />
        <details style={{ marginBottom: "0.85rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, padding: "0.75rem 0" }}>Ver Top 7 de cada día</summary>
          {dailyTopScores === null ? <p>No se pudieron cargar las partidas Top 7. El resumen de premios sigue disponible.</p> : (() => {
            const scores = dailyTopScores.filter((score) => score.player_id === entry.player_id);
            const days = [...new Set(scores.map((score) => score.tournament_day))];
            return days.length === 0 ? <p>No hay partidas Top 7 registradas para esta semana.</p> : <div style={{ display: "grid", gap: "0.85rem", marginTop: "0.5rem" }}>
              {days.map((day) => <div key={day} style={{ border: "1px solid rgba(255,255,255,.18)", borderRadius: 10, padding: "0.75rem" }}>
                <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>{day}</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                    <thead><tr>
                      <th scope="col" style={{ textAlign: "left", padding: "0.4rem", borderBottom: "1px solid #666" }}>Top</th>
                      <th scope="col" style={{ textAlign: "right", padding: "0.4rem", borderBottom: "1px solid #666" }}>Puntos</th>
                    </tr></thead>
                    <tbody>{scores.filter((score) => score.tournament_day === day).map((score) =>
                      <tr key={score.daily_rank}>
                        <td style={{ padding: "0.4rem", borderBottom: "1px solid rgba(255,255,255,.1)" }}>#{score.daily_rank}</td>
                        <td style={{ padding: "0.4rem", textAlign: "right", borderBottom: "1px solid rgba(255,255,255,.1)" }}><Link href={"/admin/prize-review/runs/" + score.validated_run_id}>{score.score.toLocaleString("en-US")} ↗</Link></td>
                      </tr>
                    )}</tbody>
                  </table>
                </div>
                <p style={{ fontSize: "0.85rem", marginTop: "0.5rem", opacity: 0.8 }}>Total del día: {scores.filter((score) => score.tournament_day === day).reduce((total, score) => total + score.score, 0).toLocaleString("en-US")}</p>
              </div>)}
            </div>;
          })()}
        </details>
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 700, padding: "0.5rem 0" }}>Ver datos de revisión del jugador</summary>
          <div style={{ overflowWrap: "anywhere" }}>
            <p><strong>ID de jugador:</strong> <code>{entry.player_id}</code></p>
            <p><strong>Usuario:</strong> {identities.get(entry.player_id)?.username || "No registrado"}</p>
            <p><strong>Correo confirmado:</strong> {identities.get(entry.player_id)?.email || "No disponible / sin confirmar"}</p>
            <p><strong>Estado del premio:</strong> {winner?.status ?? "No generado; importe previsto, no acreditado"}</p>
            <p><strong>Desempate:</strong> {entry.tie_break_status}</p>
            {playerFlags.map((flag, index) => <p key={index}><strong>Alerta:</strong> {flag.severity} · {flag.status} · {flag.signal_summary}</p>)}
          </div>
        </details>
      </article>;
    })}
    <p>Las solicitudes no constituyen autorización de pago. Cada caso requiere revisión humana.</p>
    <p><Link href={ROUTES.home}>Back to home</Link></p>
  </section>;
}
