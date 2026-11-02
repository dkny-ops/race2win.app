import { FlappyPrizeControls } from "./prize-controls";
import { BlockPlayerControl } from "../block-player-control";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Flappy Race", robots: { index: false, follow: false } };
const fmt = (d: string | null) => d ? new Date(d).toLocaleString("es", {timeZone:"America/New_York"}) : "—";
export default async function FlappyReviewPage() {
  const auth = await getAuthorizedPrizeAdmin();
  if (!auth) notFound();
  const { admin } = auth;
  const game = await admin.from("games").select("id").eq("slug","flappy-race").maybeSingle();
  if (game.error || !game.data) throw new Error("Flappy Race no disponible");
  const gameId = game.data.id;
  const monday = new Date(currentNewYorkTournamentWeek()+"T12:00:00Z");
  monday.setUTCDate(monday.getUTCDate()-7);
  const previousWeek = monday.toISOString().slice(0,10);
  const [totals,flags,winners,daily] = await Promise.all([
    admin.from("weekly_tournament_totals").select("player_id,tournament_week_start,weekly_total_score,rank_position,tie_break_status").eq("game_id",gameId).eq("tournament_week_start",previousWeek).gte("rank_position",1).lte("rank_position",3).order("rank_position",{ascending:true}).limit(3),
    admin.from("fraud_flags").select("player_id,severity,status,signal_summary,created_at").eq("game_id",gameId).in("status",["open","under_review","confirmed"]).limit(100),
    admin.from("provisional_winners").select("player_id,tournament_week_start,amount_cents,status,award_type,rank_position,admin_note").eq("game_id",gameId).eq("tournament_week_start",previousWeek).limit(20),
    admin.from("daily_top_scores").select("player_id,tournament_day,daily_rank,score,validated_run_id").eq("game_id",gameId).eq("tournament_week_start",previousWeek).lte("daily_rank",7).order("tournament_day",{ascending:true}).limit(300)
  ]);
  if ([totals,flags,winners,daily].some(r=>r.error)) throw new Error("Error al consultar Flappy Race");
  const ids = [...new Set([...(totals.data??[]).map(x=>x.player_id),...(flags.data??[]).map(x=>x.player_id),...(winners.data??[]).map(x=>x.player_id)])].filter((x):x is string=>typeof x==="string");
  const profiles = ids.length ? await admin.from("profiles").select("user_id,username").in("user_id",ids) : {data:[],error:null};
  const names = new Map((profiles.data??[]).map(x=>[x.user_id,x.username||x.user_id.slice(0,8)]));
  const name=(id:string)=>names.get(id)||id.slice(0,8);
  const card={border:"1px solid #405469",borderRadius:14,padding:"1rem",marginBottom:".75rem",overflowWrap:"anywhere" as const};
  return <main className="page-section shell narrow flappy-admin-review">
    <h1 className="flappy-admin-page-title">PANEL DE REVISIÓN SEMANAL</h1>
    <div className="button-row" style={{marginBottom:"1.25rem"}}>
      <Link href="/admin/prize-review/auth-401" className="button button--secondary">REVISAR ACCESOS 401 →</Link>
      <Link href="/" className="button button--secondary">← VOLVER A HOME</Link>
      <Link href="/admin/prize-review/flappy-race/players" className="button button--primary">BUSCAR JUGADOR →</Link>
    </div>
    <p>Ganadores de la semana del {previousWeek}. Solo se muestran los primeros tres puestos; premios sujetos a revisión humana.</p>
    {(totals.data??[]).length===0 ? <p>No hay ganadores clasificados para esta semana.</p> : (totals.data??[]).map(t=>{
      const prize=(winners.data??[]).find(x=>x.player_id===t.player_id&&x.award_type==="weekly_tournament");
      const alerts=(flags.data??[]).filter(x=>x.player_id===t.player_id);
      const top=(daily.data??[]).filter(x=>x.player_id===t.player_id);
      return <article className="profile-card" key={t.player_id} style={{padding:"1.25rem",marginBottom:"1rem",border:"1px solid rgba(110,255,173,.3)",borderRadius:14}}>
        <h2 style={{fontSize:"clamp(1.4rem,5vw,2.3rem)"}}>#{t.rank_position} · {name(t.player_id)}</h2>
        <p>ID de jugador: {t.player_id.slice(0,8)}</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:".75rem"}}>
          <div style={card}><small>TOTAL SEMANAL</small><h3>{t.weekly_total_score.toLocaleString("en-US")}</h3></div>
          <div style={card}><small>PREMIO PROVISIONAL</small><h3>{prize?"$"+(Number(prize.amount_cents)/100).toFixed(2):"No asignado"}</h3></div>
          <div style={card}><small>ALERTAS ABIERTAS</small><h3>{alerts.length}</h3></div>
        </div>
        <FlappyPrizeControls playerId={t.player_id} week={previousWeek} status={prize?.status??"pending"} />
        <BlockPlayerControl playerId={t.player_id} username={name(t.player_id)} />
        <details><summary>Historial de decisiones del expediente semanal</summary><p>Estado: {prize?.status??"Pendiente"}</p><p>Nota: {prize?.admin_note??"Sin observaciones"}</p></details>
        <details><summary>Ver Top 7 de cada día</summary>
          {top.length ? [...new Set(top.map(x=>x.tournament_day))].map(day=><div key={day} style={card}><strong>{day}</strong>{top.filter(x=>x.tournament_day===day).map(x=><p key={x.daily_rank}>#{x.daily_rank} · <Link href={"/admin/prize-review/flappy-race/runs/"+x.validated_run_id}>{x.score.toLocaleString("en-US")} puntos ↗</Link></p>)}</div>):<p>Sin Top 7 registrado.</p>}
        </details>
        <details><summary>Historial y datos de revisión</summary>
          <p>ID: {t.player_id}</p><p>Desempate: {t.tie_break_status}</p>
          <p>Premio: {prize?.status??"No asignado"} · {prize?.admin_note??"Sin observaciones"}</p>
          {alerts.map((f,i)=><p key={i}>{f.severity} · {f.status} · {f.signal_summary}</p>)}
        </details>
      </article>;
    })}
    <p>Las solicitudes no autorizan pagos. Las acciones financieras de Flappy requieren integración y validación independiente.</p>
  </main>;
}
