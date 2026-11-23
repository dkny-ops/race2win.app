import { BalanceHistory } from "../balance-history";
import { FlappyPrizeControls } from "./prize-controls";
import { FlappyWeekCloseControl } from "@/components/game/flappy-admin-controls";
import { FlappyAdminControls } from "@/components/game/flappy-admin-controls";
import { CompetitionIdentityEvidence } from "@/components/game/competition-identity-evidence";
import { BlockPlayerControl } from "../block-player-control";
import { OtherGameAdminLinks } from "@/components/game/other-game-admin-links";
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
  const [totals,flags,winners,daily,prizeReview,pendingRunsFirstPage,pendingRunsSecondPage] = await Promise.all([
    admin.from("weekly_tournament_totals").select("player_id,tournament_week_start,weekly_total_score,rank_position,tie_break_status").eq("game_id",gameId).eq("tournament_week_start",previousWeek).gte("rank_position",1).lte("rank_position",3).order("rank_position",{ascending:true}).limit(3),
    admin.from("fraud_flags").select("player_id,severity,status,signal_summary,created_at").eq("game_id",gameId).in("status",["open","under_review","confirmed"]).limit(100),
    admin.from("provisional_winners").select("id,player_id,tournament_week_start,amount_cents,status,award_type,rank_position,admin_note").eq("game_id",gameId).eq("tournament_week_start",previousWeek).limit(20),
    admin.from("daily_top_scores").select("player_id,tournament_day,daily_rank,score,validated_run_id").eq("game_id",gameId).eq("tournament_week_start",previousWeek).lte("daily_rank",7).order("tournament_day",{ascending:true}).limit(300),
    admin.rpc("flappy_admin_read_prize_cases", {p_actor:auth.context.userId,p_week:previousWeek}),
    admin.rpc("flappy_admin_read", {p_actor:auth.context.userId,p_page:1,p_session:null}),
    admin.rpc("flappy_admin_read", {p_actor:auth.context.userId,p_page:2,p_session:null})
  ]);
  if ([totals,flags,winners,daily,prizeReview,pendingRunsFirstPage,pendingRunsSecondPage].some(r=>r.error)) throw new Error("Error al consultar Flappy Race");
  const prizeCaseStates = new Map<string,string>();
  type RetainedRun = { session_id: string; score: number; verification: string; eligibility: string; completed_at: string | null; tournament_week_start: string | null };
  const retainedRuns: RetainedRun[] = [...(Array.isArray(pendingRunsFirstPage.data) ? pendingRunsFirstPage.data : []), ...(Array.isArray(pendingRunsSecondPage.data) ? pendingRunsSecondPage.data : [])].filter((run): run is RetainedRun =>
    !!run && typeof run === "object" && typeof run.session_id === "string" &&
    typeof run.score === "number" && run.eligibility === "under_review" &&
    run.tournament_week_start === previousWeek,
  );
  const candidates: {playerId:string;username:string;weeklyTotal:number;effectiveRank:number;state:string;scores:number[];dailyTopSeven:{day:string;runs:{sessionId:string;score:number;replayVerified:boolean}[]}[]}[] = [];
  const dossier:unknown = prizeReview.data;
  if (dossier && typeof dossier==="object" && !Array.isArray(dossier) && "enabled" in dossier && dossier.enabled===true && "candidates" in dossier && Array.isArray(dossier.candidates)) {
    for (const candidate of dossier.candidates) {
      if (!candidate || typeof candidate!=="object" || typeof candidate.playerId!=="string" || typeof candidate.state!=="string" || typeof candidate.effectiveRank!=="number" || !Number.isInteger(candidate.effectiveRank) || candidate.effectiveRank<1 || candidate.effectiveRank>3) continue;
      if (["pending_review","needs_additional_review","approved","rejected"].includes(candidate.state)) {
        prizeCaseStates.set(candidate.playerId,candidate.state);
        candidates.push({playerId:candidate.playerId,username:typeof candidate.username==="string"?candidate.username:"",weeklyTotal:typeof candidate.weeklyTotal==="number"?candidate.weeklyTotal:0,effectiveRank:candidate.effectiveRank,state:candidate.state,scores:Array.isArray(candidate.scores)?candidate.scores.filter((v:unknown):v is number=>typeof v==="number"):[],dailyTopSeven:Array.isArray(candidate.dailyTopSeven)?candidate.dailyTopSeven.filter((d:unknown)=>!!d&&typeof d==="object"&&"day" in d&&"runs" in d).map((d:{day:string;runs:{sessionId:string;score:number;replayVerified:boolean}[]})=>({day:d.day,runs:Array.isArray(d.runs)?d.runs:[]})):[]});
      }
    }
  }
  candidates.sort((a,b)=>a.effectiveRank-b.effectiveRank);
  const ids = [...new Set([...candidates.map(x=>x.playerId),...(totals.data??[]).map(x=>x.player_id),...(flags.data??[]).map(x=>x.player_id),...(winners.data??[]).map(x=>x.player_id)])].filter((x):x is string=>typeof x==="string");
  const balanceResult = ids.length ? await admin.from("prize_balances").select("player_id,available_cents").in("player_id",ids) : {data:[],error:null};
  if (balanceResult.error) throw new Error("No se pudieron verificar los balances");
  const balances = new Map((balanceResult.data??[]).map(x=>[x.player_id,x.available_cents]));
  const profiles = ids.length ? await admin.from("profiles").select("user_id,username").in("user_id",ids) : {data:[],error:null};
  const names = new Map((profiles.data??[]).map(x=>[x.user_id,x.username||x.user_id.slice(0,8)]));
  const name=(id:string)=>names.get(id)||id.slice(0,8);
  const liveRankingResult = await admin.rpc("flappy_read_ranking", { p_week: previousWeek, p_page: 1 });
  const liveEntries = liveRankingResult.error || !liveRankingResult.data || typeof liveRankingResult.data !== "object" || Array.isArray(liveRankingResult.data) || !Array.isArray((liveRankingResult.data as { entries?: unknown }).entries)
    ? [] : (liveRankingResult.data as { entries: unknown[] }).entries.filter((entry): entry is { rank: number | null; username: string; weeklyTotal: number; reviewRequired: boolean } => !!entry && typeof entry === "object" && typeof (entry as { username?: unknown }).username === "string" && typeof (entry as { weeklyTotal?: unknown }).weeklyTotal === "number" && (typeof (entry as { rank?: unknown }).rank === "number" || (entry as { rank?: unknown }).rank === null));
  const liveNames = liveEntries.filter(entry => typeof entry.rank === "number" && entry.rank >= 1 && entry.rank <= 3).map(entry => entry.username);
  const liveProfilesResult = liveNames.length ? await admin.from("profiles").select("user_id,username").in("username", liveNames) : { data: [], error: null };
  const liveProfiles = new Map((liveProfilesResult.data ?? []).filter(profile => profile.username).map(profile => [profile.username as string, profile.user_id]));
  const provisional = candidates.length === 0 ? liveEntries.filter(entry => typeof entry.rank === "number" && entry.rank >= 1 && entry.rank <= 3).map(entry => ({ ...entry, playerId: liveProfiles.get(entry.username) ?? null })) : [];
  const provisionalIds = provisional.flatMap(entry => entry.playerId ? [entry.playerId] : []);
  const provisionalFlagsResult = provisionalIds.length ? await admin.from("fraud_flags").select("player_id").eq("game_id", gameId).in("player_id", provisionalIds).in("status", ["open", "under_review", "confirmed"]) : { data: [], error: null };
  const provisionalFlagCounts = new Map<string, number>();
  for (const flag of provisionalFlagsResult.data ?? []) provisionalFlagCounts.set(flag.player_id, (provisionalFlagCounts.get(flag.player_id) ?? 0) + 1);
  const card={border:"1px solid #405469",borderRadius:14,padding:"1rem",marginBottom:".75rem",overflowWrap:"anywhere" as const};
  return <main className="page-section shell narrow flappy-admin-review">
    <h1 className="flappy-admin-page-title">PANEL DE REVISIÓN SEMANAL</h1>
    <div className="button-row" style={{marginBottom:"1.25rem"}}>
      <Link href="/admin/prize-review/auth-401" className="button button--secondary">REVISAR ACCESOS 401 →</Link>
      <Link href="/" className="button button--secondary">← VOLVER A HOME</Link>
      <Link href="/admin/prize-review/flappy-race/players" className="button button--primary">BUSCAR JUGADOR →</Link>
    </div>
    <p>Ganadores de la semana del {previousWeek}. Solo se muestran los primeros tres puestos; premios sujetos a revisión humana.</p>
    {retainedRuns.length > 0 && <section className="profile-card" style={{...card, border:"1px solid rgba(255,193,7,.55)"}}>
      <h2>PARTIDAS RETENIDAS ANTES DEL CIERRE</h2>
      <p>Estas {retainedRuns.length} partidas no están abiertas: el servidor las retuvo para una decisión humana. Revísalas antes de cerrar la semana. Aprobar solo incluye un replay que el servidor ya confirmó; rechazar no modifica balances ni ejecuta pagos.</p>
      {retainedRuns.map(run => <details key={run.session_id} style={{margin:".75rem 0"}}>
        <summary>{fmt(run.completed_at)} · {run.score.toLocaleString("en-US")} puntos · {run.verification === "replay_verified" ? "replay verificado" : "replay no verificable"}</summary>
        <p>Sesión: {run.session_id.slice(0, 8)} · Estado: {run.eligibility}</p>
        <FlappyAdminControls sessionId={run.session_id} replayMatches={run.verification === "replay_verified"} />
      </details>)}
    </section>}
    <FlappyWeekCloseControl week={previousWeek} />
    <p style={{ fontSize: ".9rem", opacity: .8 }}>El cierre congela únicamente la clasificación del período. No acredita balances ni ejecuta pagos; después abre los expedientes de los tres candidatos para revisión manual.</p>
    {candidates.length===0 ? <><h2>CLASIFICACIÓN PROVISIONAL DE LA SEMANA</h2><p>Estos son los tres primeros del ranking verificado. Las acciones de premio permanecen bloqueadas hasta que todos los resultados pendientes se revisen y la semana se cierre formalmente.</p>{provisional.length === 0 ? <p>No hay resultados verificables para esta semana.</p> : provisional.map(t => <article className="profile-card" key={t.username} style={{padding:"1.25rem",marginBottom:"1rem",border:"1px solid rgba(110,255,173,.3)",borderRadius:14}}>
      <h2 style={{fontSize:"clamp(1.4rem,5vw,2.3rem)"}}>#{t.rank} · {t.username}</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:".75rem"}}>
        <div style={card}><small>TOTAL SEMANAL</small><h3>{t.weeklyTotal.toLocaleString("en-US")}</h3></div>
        <div style={card}><small>PREMIO PROVISIONAL</small><h3>{t.rank===1?"$5.00":t.rank===2?"$3.00":"$2.00"}</h3></div>
        <div style={card}><small>ALERTAS ABIERTAS</small><h3>{t.playerId ? provisionalFlagCounts.get(t.playerId) ?? 0 : "—"}</h3></div>
        <div style={card}><small>ESTADO</small><h3>{t.reviewRequired?"EMPATE · REVISIÓN":"PENDIENTE DE CIERRE"}</h3></div>
      </div>
      {t.playerId ? <><BalanceHistory playerId={t.playerId} /><CompetitionIdentityEvidence actor={auth.context.userId} player={t.playerId} week={previousWeek} /></> : <p>La identidad del jugador no pudo cargarse; no se habilitan acciones administrativas.</p>}
      <p>La evidencia detallada, código de verificación, crédito y pago se habilitarán solo después del cierre seguro del período.</p>
    </article>)}</> : candidates.map(t=>{
      const prize=(winners.data??[]).find(x=>x.player_id===t.playerId&&x.award_type==="weekly_tournament");
      const alerts=(flags.data??[]).filter(x=>x.player_id===t.playerId);
      const top=(daily.data??[]).filter(x=>x.player_id===t.playerId);
      return <article className="profile-card" key={t.playerId} style={{padding:"1.25rem",marginBottom:"1rem",border:"1px solid rgba(110,255,173,.3)",borderRadius:14}}>
        <h2 style={{fontSize:"clamp(1.4rem,5vw,2.3rem)"}}>#{t.effectiveRank} · {(t.username||name(t.playerId))}</h2>
        <p>ID de jugador: {t.playerId.slice(0,8)}</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:".75rem"}}>
          <div style={card}><small>TOTAL SEMANAL</small><h3>{t.weeklyTotal.toLocaleString("en-US")}</h3></div>
          <div style={card}><small>PREMIO PROVISIONAL</small><h3>{prize?"$"+(Number(prize.amount_cents)/100).toFixed(2):"No asignado"}</h3></div>
          <div style={card}><small>ALERTAS ABIERTAS</small><h3>{alerts.length}</h3></div>
        </div>
        <p>Estado del candidato: {t.state==="pending_review"?"Pendiente de revisión":t.state==="approved"?"Aprobado":t.state==="rejected"?"Rechazado":"Revisión adicional"}</p>
        <BalanceHistory playerId={t.playerId} />
        <CompetitionIdentityEvidence actor={auth.context.userId} player={t.playerId} week={previousWeek} />
        <OtherGameAdminLinks playerId={t.playerId} currentGame="flappy-race" />
        <FlappyPrizeControls playerId={t.playerId} week={previousWeek} status={prizeCaseStates.get(t.playerId)??"pending_review"} balanceCents={balances.get(t.playerId)??0} prizeCents={t.effectiveRank===1?500:t.effectiveRank===2?300:200} credited={prize?.status==="approved_for_payment"} winnerId={prize?.status==="approved_for_payment"?prize.id:undefined} />
        <BlockPlayerControl playerId={t.playerId} username={name(t.playerId)} />
        <details><summary>Historial de decisiones del expediente semanal</summary><p>Estado: {prize?.status??"Pendiente"}</p><p>Nota: {prize?.admin_note??"Sin observaciones"}</p></details>
        <details><summary>Ver puntuaciones clasificadas</summary><p>{t.scores.length?t.scores.join(" · "):"Sin puntuaciones registradas."}</p></details>
        <details><summary>Ver Top 7 de cada día</summary>
          {t.dailyTopSeven.length ? t.dailyTopSeven.map(day=><div key={day.day} style={card}><strong>{day.day}</strong>{day.runs.map((run,index)=><p key={run.sessionId}>#{index+1} · <Link href={"/admin/prize-review/flappy-race/runs/"+run.sessionId}>{run.score.toLocaleString("en-US")} puntos ↗</Link> · {run.replayVerified?"Validada":"Requiere revisión"}</p>)}</div>):<p>Sin Top 7 registrado.</p>}
        </details>
        <details><summary>Historial y datos de revisión</summary>
          <p>ID: {t.playerId}</p><p>Desempate: {"Clasificación Flappy"}</p>
          <p>Premio: {prize?.status??"No asignado"} · {prize?.admin_note??"Sin observaciones"}</p>
          {alerts.map((f,i)=><p key={i}>{f.severity} · {f.status} · {f.signal_summary}</p>)}
        </details>
      </article>;
    })}
    <p>Las solicitudes no autorizan pagos. Las acciones financieras de Flappy requieren integración y validación independiente.</p>
  </main>;
}
