import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { summarizeFlappyAudit } from "@/lib/game/flappy/admin-review";

export const dynamic = "force-dynamic";
export const metadata = { title: "FlappyRace · revisión", robots: { index: false, follow: false } };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FlappyAdminPage({ searchParams }: { searchParams: Promise<{ session?: string; page?: string }> }) {
  const authorization = await getAuthorizedPrizeAdmin();
  if (!authorization) notFound();
  const params = await searchParams;
  const page = Number(params.page ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > 100 || (params.session !== undefined && !uuid.test(params.session))) notFound();
  const { data, error } = await authorization.admin.rpc("flappy_admin_read", {
    p_actor: authorization.context.userId, p_page: page, p_session: params.session ?? null,
  });
  const rows = !error && Array.isArray(data) ? data.map(summarizeFlappyAudit) : null;
  return <section className="page-section shell narrow">
    <Link href="/admin/prize-review">← Administración</Link>
    <h1>FlappyRace · revisión de evidencias</h1>
    <p>Solo lectura. Un replay válido no demuestra que el jugador sea humano. Esta pantalla no aprueba resultados ni genera premios o pagos.</p>
    {rows === null ? <p role="status">Revisión no disponible: la migración de FlappyRace está pendiente de autorización y aplicación. No se muestran partidas ficticias.</p> : <>
      {!rows.length ? <p>No hay partidas en esta consulta.</p> : null}
      {rows.map(row => <article key={row.session_id} style={{ border: "1px solid #334155", borderRadius: 12, padding: 16, marginBlock: 16, overflowWrap: "anywhere" }}>
        <h2>{row.username ?? "Sin nombre"}</h2>
        <p>Jugador: {row.player_id}</p>
        <p>Partida: <Link href={"?session=" + row.session_id}>{row.session_id}</Link></p>
        <p>Inicio: {row.created_at} · Final: {row.completed_at ?? "Sin finalizar"}</p>
        <p>Puntuación: {row.score ?? "Sin resultado"} · Estado: {row.status} · Revisión: {row.eligibility ?? "Sin resultado"}</p>
        <p>Día NY: {row.tournament_day ?? "—"} · Semana NY: {row.tournament_week_start ?? "—"}</p>
        <p>Motor: {row.version} · Tick: {row.tick} · Colisión: {row.collision_tick ?? "—"} · Entradas: {row.input_count}</p>
        <p>SHA-256: {row.digest ?? "Sin evidencia"}</p>
        <p>Replay: {row.replayMatches === null ? "Abre la partida para comprobarlo" : row.replayMatches ? "Coincide con la evidencia persistida" : "NO COINCIDE · requiere investigación"}</p>
        <p>Riesgo: automatización no descartada; revisión humana requerida. Recompensa: {row.reward_reserved ? "Reserva sin concesión" : "Sin reserva"}.</p>
        {row.review_note ? <p>Nota: {row.review_note} · {row.reviewed_at}</p> : null}
      </article>)}
      {!params.session ? <nav aria-label="Páginas de revisión">{page > 1 ? <Link href={"?page=" + (page - 1)}>← Anterior </Link> : null}{rows.length === 50 && page < 100 ? <Link href={"?page=" + (page + 1)}>Siguiente →</Link> : null}</nav> : <Link href="/admin/prize-review/flappy-race">Todas las partidas</Link>}
    </>}
  </section>;
}
