import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";

type LedgerRow = { id:string;game_id:string;provisional_winner_id:string|null;payout_id:string|null;entry_type:string;amount_cents:number;created_at:string;reason:string|null };
type Winner = { id:string;tournament_week_start:string;rank_position:number|null;award_type:string;amount_cents:number };
type Game = {id:string;slug:string;display_name:string};
const cash=(v:number)=>"$"+(v/100).toFixed(2);
const date=(v:string)=>new Date(v).toLocaleString("es-US",{timeZone:"America/New_York",year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
export async function BalanceHistory({playerId}:{playerId:string}){
 const auth=await getAuthorizedPrizeAdmin();
 if(!auth)return null;
 const {admin}=auth;
 const [balance,ledger,payouts]=await Promise.all([
  admin.from("prize_balances").select("available_cents").eq("player_id",playerId).maybeSingle(),
  admin.from("prize_ledger_entries").select("id,game_id,provisional_winner_id,payout_id,entry_type,amount_cents,created_at,reason").eq("player_id",playerId).order("created_at",{ascending:false}).limit(300),
  admin.from("payouts").select("id,amount_cents,status,paid_at,requested_at").eq("player_id",playerId).order("requested_at",{ascending:false}).limit(100),
 ]);
 if(balance.error||ledger.error||payouts.error)return <p role="alert">Historial contable no disponible. No se puede verificar el saldo.</p>;
 const rows=(ledger.data??[]) as LedgerRow[];
 const gameIds=[...new Set(rows.map(r=>r.game_id))];
 const winnerIds=[...new Set(rows.map(r=>r.provisional_winner_id).filter((x):x is string=>!!x))];
 const [gamesResult,winnersResult]=await Promise.all([
  gameIds.length?admin.from("games").select("id,slug,display_name").in("id",gameIds):Promise.resolve({data:[],error:null}),
  winnerIds.length?admin.from("provisional_winners").select("id,tournament_week_start,rank_position,award_type,amount_cents").in("id",winnerIds):Promise.resolve({data:[],error:null})
 ]);
 if(gamesResult.error||winnersResult.error)return <p role="alert">No se pudieron verificar los premios del historial.</p>;
 const games=new Map(((gamesResult.data??[]) as Game[]).map(g=>[g.id,g]));
 const winners=new Map(((winnersResult.data??[]) as Winner[]).map(w=>[w.id,w]));
 const raceCredits=rows.filter(r=>r.entry_type==="credit"&&games.get(r.game_id)?.slug==="race-to-win");
 const raceWeeks=[...new Set(raceCredits.map(r=>winners.get(r.provisional_winner_id??"")?.tournament_week_start).filter((x):x is string=>!!x))];
 const raceGame=([...games.values()]).find(g=>g.slug==="race-to-win");
 const raceTotals=raceGame&&raceWeeks.length?await admin.from("weekly_tournament_totals").select("tournament_week_start,weekly_total_score").eq("game_id",raceGame.id).eq("player_id",playerId).in("tournament_week_start",raceWeeks):{data:[],error:null};
 const scores=new Map<string,number>();
 if(!raceTotals.error)for(const t of raceTotals.data??[])scores.set("race-to-win:"+t.tournament_week_start,t.weekly_total_score);
 const flappyWeeks=[...new Set(rows.filter(r=>r.entry_type==="credit"&&games.get(r.game_id)?.slug==="flappy-race").map(r=>winners.get(r.provisional_winner_id??"")?.tournament_week_start).filter((x):x is string=>!!x))];
 await Promise.all(flappyWeeks.map(async week=>{
  const result=await admin.rpc("flappy_admin_read_prize_cases",{p_actor:auth.context.userId,p_week:week});
  const data:unknown=result.data;
  if(result.error||!data||typeof data!=="object"||!("candidates" in data)||!Array.isArray(data.candidates))return;
  const candidate=data.candidates.find((c:unknown)=>c&&typeof c==="object"&&"playerId" in c&&c.playerId===playerId);
  if(candidate&&typeof candidate.weeklyTotal==="number")scores.set("flappy-race:"+week,candidate.weeklyTotal);
 }));
 const payoutMap=new Map((payouts.data??[]).map(p=>[p.id,p]));
 return <details style={{margin:"1rem 0",border:"1px solid #3d596b",borderRadius:12,padding:"1rem",overflowWrap:"anywhere"}}>
  <summary style={{cursor:"pointer",fontWeight:800}}>HISTORIAL PRIVADO DEL BALANCE · {cash(Number(balance.data?.available_cents??0))}</summary>
  <p>Solo administrador. Premios acreditados, fecha, torneo, puntuación y pagos registrados. Los movimientos permanecen después de pagar.</p>
  <div style={{display:"grid",gap:".7rem"}}>
   {rows.length===0?<p>No hay movimientos contables registrados.</p>:rows.map(row=>{
    const game=games.get(row.game_id);
    const winner=winners.get(row.provisional_winner_id??"");
    const score=winner?scores.get((game?.slug??"")+":"+winner.tournament_week_start):undefined;
    const payout=row.payout_id?payoutMap.get(row.payout_id):undefined;
    return <article key={row.id} style={{border:"1px solid #314a58",borderRadius:10,padding:".75rem"}}>
     <strong>{game?.display_name??game?.slug??"Juego no disponible"} · {row.entry_type==="credit"?"PREMIO ACREDITADO":row.entry_type==="debit"?"DÉBITO / PAGO":row.entry_type==="reversal"?"REVERSIÓN":row.entry_type}</strong>
     <p style={{margin:".3rem 0"}}>Importe: <strong>{row.amount_cents>=0?"+":""}{cash(row.amount_cents)}</strong> · Fecha: {date(row.created_at)}</p>
     {winner&&<p style={{margin:".3rem 0"}}>Semana: {winner.tournament_week_start} · Puesto: {winner.rank_position??"—"} · Score semanal: {score===undefined?"No disponible":score.toLocaleString("en-US")}</p>}
     {payout&&<p style={{margin:".3rem 0"}}>Pago: {payout.status} · {payout.paid_at?date(payout.paid_at):"Sin fecha de pago"}</p>}
     {row.reason&&<p style={{margin:".3rem 0"}}>Motivo: {row.reason}</p>}
    </article>;
   })}
  </div>
  <p style={{fontSize:".8rem",opacity:.8}}>Se muestran los últimos 300 movimientos y los últimos 100 pagos. El balance oficial proviene de Supabase.</p>
 </details>;
}
