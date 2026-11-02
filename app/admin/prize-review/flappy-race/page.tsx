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
  const [sessions,runs,totals,flags,winners,daily] = await Promise.all([
    admin.from("game_sessions").select("id,user_id,status,started_at,final_score,anti_fraud_status").eq("game_id",gameId).order("started_at",{ascending:false}).limit(50),
    admin.from("validated_runs").select("player_id,score,completed_at,eligibility_status").eq("game_id",gameId).order("completed_at",{ascending:false}).limit(50),
    admin.from("weekly_tournament_totals").select("player_id,tournament_week_start,weekly_total_score,rank_position").eq("game_id",gameId).order("tournament_week_start",{ascending:false}).limit(50),
    admin.from("fraud_flags").select("player_id,severity,status,signal_summary,created_at").eq("game_id",gameId).order("created_at",{ascending:false}).limit(50),
    admin.from("provisional_winners").select("player_id,tournament_week_start,amount_cents,status,award_type,rank_position,admin_note").eq("game_id",gameId).order("created_at",{ascending:false}).limit(50),
    admin.from("daily_top_scores").select("player_id,tournament_day,daily_rank,score").eq("game_id",gameId).order("tournament_day",{ascending:false}).limit(350)
  ]);
  if ([sessions,runs,totals,flags,winners,daily].some(r=>r.error)) throw new Error("Error al consultar Flappy Race");
  const ids = [...new Set([...(sessions.data??[]).map(x=>x.user_id),...(runs.data??[]).map(x=>x.player_id),...(totals.data??[]).map(x=>x.player_id),...(flags.data??[]).map(x=>x.player_id),...(winners.data??[]).map(x=>x.player_id)])].filter((x):x is string=>typeof x==="string");
  const profiles = ids.length ? await admin.from("profiles").select("user_id,username").in("user_id",ids) : {data:[],error:null};
  const names = new Map((profiles.data??[]).map(x=>[x.user_id,x.username||x.user_id.slice(0,8)]));
  const name=(id:string)=>names.get(id)||id.slice(0,8);
  const card={border:"1px solid #405469",borderRadius:14,padding:"1rem",marginBottom:".75rem",overflowWrap:"anywhere" as const};
  return <main className="page-section shell narrow">
    <p className="eyebrow">OWNER REVIEW · SOLO LECTURA</p>
    <Link href="/admin/prize-review" className="button button--secondary">← VOLVER AL PANEL</Link>
    <h1>PANEL DE REVISIÓN · FLAPPY RACE</h1>
    <p>Revisión exclusiva de Flappy Race. Últimos 50 registros por sección; sin modificaciones financieras.</p>
    <h2>JUGADORES · SEMANA ACTUAL</h2>
    {(totals.data??[]).filter(t=>t.tournament_week_start===currentNewYorkTournamentWeek()).map(t=>{
      const prize=(winners.data??[]).find(x=>x.player_id===t.player_id&&x.tournament_week_start===t.tournament_week_start);
      const alerts=(flags.data??[]).filter(x=>x.player_id===t.player_id);
      const top=(daily.data??[]).filter(x=>x.player_id===t.player_id&&x.tournament_day>=t.tournament_week_start);
      return <article key={t.player_id} style={card}>
        <h2>#{t.rank_position??"—"} · {name(t.player_id)}</h2>
        <p>ID: {t.player_id.slice(0,8)}</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:".75rem"}}>
          <div style={card}><small>TOTAL SEMANAL</small><h2>{t.weekly_total_score.toLocaleString("en-US")}</h2></div>
          <div style={card}><small>PREMIO PROVISIONAL</small><h2>{prize ? "$"+(Number(prize.amount_cents)/100).toFixed(2) : "No asignado"}</h2></div>
          <div style={card}><small>ALERTAS</small><h2>{alerts.length}</h2></div>
        </div>
        <details><summary>Ver Top 7 de cada día</summary>
          {top.length ? [...new Set(top.map(x=>x.tournament_day))].map(day=><div key={day}><h3>{day}</h3>{top.filter(x=>x.tournament_day===day).map(x=><p key={x.daily_rank}>#{x.daily_rank} · {x.score} puntos</p>)}</div>) : <p>Sin Top 7 esta semana.</p>}
        </details>
        <details><summary>Historial y datos de revisión</summary>
          <p>ID: {t.player_id}</p><p>Desempate: {t.tie_break_status}</p>
          <p>Premio: {prize?.status??"No asignado"} · {prize?.admin_note??"Sin observaciones"}</p>
          {alerts.map((f,i)=><p key={i}>{f.severity} · {f.status} · {f.signal_summary}</p>)}
        </details>
      </article>;
    })}
    <h2>PARTIDAS DE JUGADORES</h2>
    {(sessions.data??[]).length ? sessions.data!.map(s=><article key={s.id} style={card}><strong>{name(s.user_id)}</strong><p>{fmt(s.started_at)} · {s.status} · {s.final_score??"Sin puntuación"} puntos</p><p>Antifraude: {s.anti_fraud_status||"—"}</p><small>Partida: {s.id}</small></article>):<p>Sin partidas.</p>}
    <h2>RESULTADOS VALIDADOS</h2>
    {(runs.data??[]).length ? runs.data!.map((r,i)=><article key={i} style={card}><strong>{name(r.player_id)}</strong><p>{fmt(r.completed_at)} · {r.score} puntos · {r.eligibility_status}</p></article>):<p>Sin resultados validados.</p>}
    <h2>RESULTADOS SEMANALES</h2>
    {(totals.data??[]).length ? totals.data!.map((t,i)=><article key={i} style={card}><strong>{name(t.player_id)}</strong><p>Semana {t.tournament_week_start} · {t.weekly_total_score} puntos · posición {t.rank_position??"—"}</p></article>):<p>Sin resultados semanales.</p>}
    <h2>PREMIOS PROVISIONALES</h2>
    {(winners.data??[]).length ? winners.data!.map((w,i)=><article key={i} style={card}><strong>{name(w.player_id)}</strong><p>Semana {w.tournament_week_start} · {Number(w.amount_cents)/100} USD · {w.status} · {w.award_type}</p></article>):<p>Sin premios provisionales.</p>}
    <h2>ALERTAS DE SEGURIDAD</h2>
    {(flags.data??[]).length ? flags.data!.map((f,i)=><article key={i} style={card}><strong>{name(f.player_id)}</strong><p>{fmt(f.created_at)} · {f.severity} · {f.status}</p><p>{f.signal_summary}</p></article>):<p>Sin alertas registradas.</p>}
    <p>Los controles de códigos, balances, pagos y bloqueos requieren integración específica y validación de seguridad antes de habilitarse para Flappy Race.</p>
  </main>;
}
