"use client";
import {useEffect,useState} from "react";
type Status={week:string;state:string;closedAt:string|null;pendingRuns:number;exactTiesPending:boolean;winners:{rank:number;username:string;weeklyTotal:number}[];prizesEnabled?:boolean;prizeEffectiveAt?:string|null;prizeInauguralWeekStart?:string|null;paymentsEnabled?:boolean};
export function FlappyTournamentStatus({language}:{language:"en"|"es"}){
 const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(false),es=language==="es";
 useEffect(()=>{
  let active=true;const controller=new AbortController();
  async function load(){
   try{const r=await fetch("/api/flappy-race/tournament",{cache:"no-store",signal:controller.signal});if(!r.ok)throw new Error();
    const result=await r.json();if(typeof result.week!=="string"||!Array.isArray(result.winners))throw new Error();
    if(active){setStatus(result);setError(false);}
   }catch{if(active)setError(true);}
  }
  void load();const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void load();},60000);
  return()=>{active=false;controller.abort();window.clearInterval(timer);};
 },[]);
 const state=status?.state==="closed"?(es?"Cerrada":"Closed"):status?.state==="awaiting_review"?(es?"Pendiente de revisión":"Awaiting review"):status?.state==="ready_to_close"?(es?"Pendiente de cierre administrativo":"Awaiting admin closure"):(es?"En curso":"Open");
 return <section className="scores-page flappy-ranking" aria-label={es?"Cierre semanal de FlappyRace":"FlappyRace weekly closure"}><div className="scores-panel">
  <h2>{es?"CIERRE SEMANAL":"WEEKLY CLOSURE"}</h2>
  {error?<p role="status">{es?"El estado del cierre no está disponible.":"Closure status unavailable."}</p>:!status?<p role="status">{es?"Cargando…":"Loading…"}</p>:<>
   <p>{es?"Semana del":"Week of"} {status.week} · {state}</p>
   <p>{es?"Resultados pendientes":"Pending results"}: {status.pendingRuns}</p>
   {status.prizesEnabled&&status.prizeEffectiveAt?<p>{es?"Premios de FlappyRace activos desde":"FlappyRace prizes active from"} <strong>{new Date(status.prizeEffectiveAt).toLocaleString(es?"es-US":"en-US",{timeZone:"America/New_York"})}</strong>. {es?"Solo cuentan partidas iniciadas después de esa hora, hasta el próximo cierre semanal.":"Only runs started after that server time count through the next weekly close."}</p>:null}
   {status.exactTiesPending?<p>{es?"Empates absolutos pendientes. No se adjudica un ganador por orden arbitrario.":"Exact ties pending. No arbitrary winner assigned."}</p>:null}
   {status.state==="closed"?status.winners.length?<ol>{status.winners.map(w=><li key={w.rank}>#{w.rank} {w.username} · {w.weeklyTotal}</li>)}</ol>:<p>{es?"Sin ganadores determinados.":"No winners determined."}</p>:null}
  </>}
  <p>{status?.prizesEnabled?(es?"Los premios requieren revisión administrativa; no se ejecutan pagos automáticamente.":"Prizes require administrative review; payments never execute automatically."):(es?"Solo clasificación deportiva. Premios retirables y pagos automáticos desactivados.":"Standings only. Withdrawable prizes and automatic payments disabled.")}</p>
 </div></section>;
}
