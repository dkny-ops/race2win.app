import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Auditoría de partida", robots: { index: false, follow: false } };

function when(value: string | null | undefined) {
  if (!value) return "No registrado";
  return new Intl.DateTimeFormat("es-US", {
    timeZone: "America/New_York", dateStyle: "medium", timeStyle: "medium",
  }).format(new Date(value));
}

function value(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "No registrado";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value);
}

export default async function RunAuditPage({ params }: { params: Promise<{ runId: string }> }) {
  const authorization = await getAuthorizedPrizeAdmin();
  if (!authorization) notFound();
  const { admin } = authorization;
  const { runId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) notFound();

  // Require the exact run to belong to a server-maintained daily Top 7.
  const { data: top, error: topError } = await admin.from("daily_top_scores")
    .select("player_id,tournament_day,tournament_week_start,daily_rank,score,validated_run_id")
    .eq("validated_run_id", runId).maybeSingle();
  if (topError || !top) notFound();

  const { data: run, error: runError } = await admin.from("validated_runs")
    .select("id,game_session_id,player_id,game_id,score,distance_millimeters,elapsed_ms,collision_at_ms,score_multiplier,extra_life_used,completed_at,tournament_day,tournament_week_start,eligibility_status,status_updated_at,created_at,updated_at,referral_eligible")
    .eq("id", runId).eq("player_id", top.player_id).maybeSingle();
  if (runError || !run) notFound();

  const [sessionResult, flagsResult] = await Promise.all([
    admin.from("game_sessions")
      .select("id,user_id,gameplay_version,status,created_at,started_at,expires_at,finalized_at,invalidated_at,invalidation_reason,input_digest,input_count,final_score,final_distance_millimeters,final_elapsed_ms,final_collision_at_ms,checkpoint_interval_score,activity_lease_expires_at,referral_eligible,anti_fraud_status")
      .eq("id", run.game_session_id).eq("user_id", run.player_id).maybeSingle(),
    admin.from("fraud_flags")
      .select("id,severity,status,signal_summary,created_at,resolved_at")
      .eq("player_id", run.player_id).eq("subject_id", run.game_session_id).limit(30),
  ]);
  const session = sessionResult.error ? null : sessionResult.data;
  const flags = flagsResult.error ? [] : (flagsResult.data ?? []);

  const groups = [
    { title: "Identificación y clasificación", rows: [
      ["ID de partida validada", run.id], ["ID de sesión", run.game_session_id],
      ["ID de jugador", run.player_id], ["Día del torneo", top.tournament_day],
      ["Semana del torneo", top.tournament_week_start], ["Posición Top 7", top.daily_rank],
      ["Puntuación del Top 7", top.score],
    ] },
    { title: "Resultado validado por el servidor", rows: [
      ["Puntuación", run.score], ["Duración (ms)", run.elapsed_ms],
      ["Duración (segundos)", (run.elapsed_ms / 1000).toFixed(2)],
      ["Distancia (metros)", (Number(run.distance_millimeters) / 1000).toFixed(3)],
      ["Colisión (ms)", run.collision_at_ms], ["Multiplicador", run.score_multiplier],
      ["Vida extra utilizada", run.extra_life_used], ["Elegibilidad", run.eligibility_status],
      ["Elegible por referido", run.referral_eligible],
      ["Finalización (NY)", when(run.completed_at)],
      ["Estado actualizado (NY)", when(run.status_updated_at)],
    ] },
    { title: "Sesión y pruebas registradas", rows: [
      ["Versión del juego", session?.gameplay_version], ["Estado de sesión", session?.status],
      ["Creación (NY)", when(session?.created_at)], ["Inicio (NY)", when(session?.started_at)],
      ["Expiración (NY)", when(session?.expires_at)], ["Finalización (NY)", when(session?.finalized_at)],
      ["Invalidación (NY)", when(session?.invalidated_at)],
      ["Motivo de invalidación", session?.invalidation_reason],
      ["Cantidad de entradas registradas", session?.input_count],
      ["Huella de entradas (digest)", session?.input_digest],
      ["Puntuación final de sesión", session?.final_score],
      ["Distancia final de sesión (mm)", session?.final_distance_millimeters],
      ["Duración final de sesión (ms)", session?.final_elapsed_ms],
      ["Colisión final de sesión (ms)", session?.final_collision_at_ms],
      ["Intervalo de checkpoint (puntos)", session?.checkpoint_interval_score],
      ["Vencimiento de actividad (NY)", when(session?.activity_lease_expires_at)],
      ["Estado antifraude", session?.anti_fraud_status],
    ] },
  ];

  return <section className="page-section shell narrow">
    <p className="eyebrow">ADMINISTRACIÓN · SOLO LECTURA</p>
    <h1 style={{ fontSize: "clamp(1.7rem, 7vw, 3rem)", overflowWrap: "anywhere" }}>Auditoría de partida</h1>
    <p><Link href="/admin/prize-review">← Volver al panel de revisión</Link></p>
    <p>Estos datos proceden de registros persistidos en el servidor. Las entradas individuales y el replay completo no están disponibles en esta vista. La semilla del juego y los secretos de validación no se muestran.</p>
    {groups.map((group) => <article key={group.title} className="profile-card" style={{ marginTop: "1rem", padding: "1rem", borderRadius: 12 }}>
      <h2 style={{ fontSize: "1.2rem", marginBottom: "0.75rem" }}>{group.title}</h2>
      <dl style={{ display: "grid", gap: "0.6rem" }}>{group.rows.map(([label, data]) =>
        <div key={String(label)} style={{ borderBottom: "1px solid rgba(255,255,255,.13)", paddingBottom: "0.5rem", overflowWrap: "anywhere" }}>
          <dt style={{ opacity: 0.75, fontSize: "0.85rem" }}>{label}</dt>
          <dd style={{ margin: "0.25rem 0 0", fontWeight: 600 }}>{value(data)}</dd>
        </div>
      )}</dl>
    </article>)}
    <article className="profile-card" style={{ marginTop: "1rem", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.2rem" }}>Alertas de fraude asociadas</h2>
      {flags.length === 0 ? <p>No hay alertas vinculadas a esta sesión.</p> : flags.map((flag) =>
        <div key={flag.id} style={{ borderBottom: "1px solid rgba(255,255,255,.13)", padding: "0.5rem 0" }}>
          <p><strong>{flag.severity}</strong> · {flag.status}</p>
          <p>{flag.signal_summary}</p>
          <p>Registrada: {when(flag.created_at)} · Resuelta: {when(flag.resolved_at)}</p>
        </div>
      )}
    </article>
    <p>Esta página no aprueba premios, modifica puntuaciones ni realiza pagos.</p>
  </section>;
}
