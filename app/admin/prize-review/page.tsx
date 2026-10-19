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

  return <section className="page-section shell narrow">
    <p className="eyebrow">OWNER REVIEW · READ ONLY</p>
    <h1>Panel de revisión semanal</h1>
    <p>Semana del {previousWeek} · Resumen de ganadores y premios. Solo lectura: este panel no ejecuta pagos ni modifica balances.</p>
    {(totals.data ?? []).length === 0 ? <p>No ranked players for this week.</p> : (totals.data ?? []).map((entry) => {
      const winner = (winners.data ?? []).find((w) => w.player_id === entry.player_id && w.award_type === "weekly_tournament");
      const playerFlags = (flags.data ?? []).filter((flag) => flag.player_id === entry.player_id);
      const name = "Player " + entry.player_id.slice(0, 8);
      return <article className="profile-card" key={entry.player_id} style={{ marginTop: "1rem", padding: "1.25rem", border: "1px solid rgba(255,255,255,.2)", borderRadius: 14 }}>
        <h2 style={{ marginBottom: "1rem" }}>#{entry.rank_position} · {name}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
          <div style={{ padding: "0.85rem", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10 }}>
            <p style={{ opacity: 0.7, fontSize: "0.8rem" }}>TOTAL SEMANAL</p>
            <p style={{ fontWeight: 800, fontSize: "1.35rem" }}>{entry.weekly_total_score.toLocaleString("en-US")}</p>
          </div>
          <div style={{ padding: "0.85rem", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10 }}>
            <p style={{ opacity: 0.7, fontSize: "0.8rem" }}>PREMIO PROVISIONAL</p>
            <p style={{ fontWeight: 800, fontSize: "1.35rem" }}>{money(winner?.amount_cents ?? null)}</p>
          </div>
          <div style={{ padding: "0.85rem", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10 }}>
            <p style={{ opacity: 0.7, fontSize: "0.8rem" }}>ALERTAS ABIERTAS</p>
            <p style={{ fontWeight: 800, fontSize: "1.35rem" }}>{playerFlags.length}</p>
          </div>
        </div>
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 700, padding: "0.5rem 0" }}>Ver datos de revisión del jugador</summary>
          <div style={{ overflowWrap: "anywhere" }}>
            <p><strong>ID de jugador:</strong> <code>{entry.player_id}</code></p>
            <p><strong>Estado del premio:</strong> {winner?.status ?? "No generado"}</p>
            <p><strong>Desempate:</strong> {entry.tie_break_status}</p>
            {playerFlags.map((flag, index) => <p key={index}><strong>Alerta:</strong> {flag.severity} · {flag.status} · {flag.signal_summary}</p>)}
          </div>
        </details>
      </article>;
    })}
    <h2>Solicitudes de retiro pendientes (máximo 50)</h2>
    <PayoutEmailReview requests={(payouts.data ?? []).map((p) => ({
      id: p.id, playerId: p.player_id, amountCents: p.amount_cents, status: p.status,
    }))} />
    <p>Las solicitudes no constituyen autorización de pago. Cada caso requiere revisión humana.</p>
    <p><Link href={ROUTES.home}>Back to home</Link></p>
  </section>;
}
