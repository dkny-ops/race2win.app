"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function FlappyPrizeControls({playerId,week,status}:{playerId:string;week:string;status:string}) {
 const [note,setNote]=useState(""); const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
 const router=useRouter();
 async function act(action:"approved"|"rejected"|"needs_additional_review"|"allocate"){
  if(!note.trim() || busy)return;
  const label=action==="allocate"?"ACREDITAR el premio al balance":action==="approved"?"aprobar al candidato":action==="rejected"?"rechazar al candidato":"solicitar revisión adicional";
  if(!window.confirm("¿Confirmas "+label+"? Esta decisión se registrará en el servidor. Ningún pago será ejecutado."))return;
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/admin/flappy-race/prizes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({week,playerId,action,note:note.trim()}),cache:"no-store"});
   const body=await response.json().catch(()=>({message:"Respuesta no disponible"})) as {message?:string};
   setMessage(body.message||"Operación procesada.");
   if(response.ok){setNote("");router.refresh();}
  }catch{setMessage("No se pudo conectar. No se confirmó ningún cambio.");}
  finally{setBusy(false);}
 }
 return <section style={{display:"grid",gap:".7rem",margin:"1rem 0"}}>
  <h3 style={{fontSize:"1rem"}}>Acciones del propietario</h3>
  <p>Estado: {status}. Primero revisa las partidas y alertas. Aprobar candidato NO acredita dinero; acreditar NO ejecuta un pago.</p>
  <label>Motivo y evidencia de la decisión <textarea required rows={3} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} style={{display:"block",width:"100%"}} /></label>
  <div className="button-row">
   <button type="button" className="button button--secondary" disabled={busy||!note.trim()} onClick={()=>void act("approved")}>APROBAR CANDIDATO</button>
   <button type="button" className="button button--secondary" disabled={busy||!note.trim()} onClick={()=>void act("needs_additional_review")}>REVISIÓN ADICIONAL</button>
   <button type="button" className="button button--secondary" disabled={busy||!note.trim()} onClick={()=>void act("rejected")}>RECHAZAR CANDIDATO</button>
   <button type="button" className="button button--primary" disabled={busy||!note.trim()||status!=="approved"} onClick={()=>void act("allocate")}>VALIDAR BALANCE</button>
  </div>
  <p>Pago exitoso: no disponible en este panel hasta contar con un registro de pago Flappy independiente y verificado.</p>
  {message&&<p role="status">{message}</p>}
 </section>;
}
