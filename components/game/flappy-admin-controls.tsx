"use client";
import { useState,type FormEvent } from "react";
import { useRouter } from "next/navigation";
export function FlappyAdminControls({sessionId,replayMatches}:{sessionId:string;replayMatches:boolean|null}){
 const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;
  const form=new FormData(event.currentTarget),decision=form.get("decision");
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/admin/flappy-race/review",{method:"POST",credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(15000),headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId,decision,note:form.get("note"),humanReviewed:form.get("humanReviewed")==="on"})});
   if(!response.ok)throw new Error();
   setMessage("Decisión registrada. Sin premios ni pagos.");router.refresh();
  }catch{setMessage("No se pudo registrar. Revisa permisos, evidencia y estado del cierre.");}finally{setBusy(false);}
 }
 return <form onSubmit={submit}>
  <label>Decisión <select name="decision" required defaultValue="disqualified"><option value="disqualified">Rechazar</option><option value="valid" disabled={replayMatches!==true}>Aprobar resultado para ranking</option></select></label>
  <label style={{display:"block"}}>Motivo y evaluación de automatización<textarea name="note" required maxLength={500} rows={3} style={{display:"block",width:"100%"}} /></label>
  <label><input type="checkbox" name="humanReviewed" required /> He revisado la evidencia y el riesgo de bots. El replay no demuestra juego humano.</label>
  <button type="submit" className="button" disabled={busy}>{busy?"Guardando…":"REGISTRAR REVISIÓN"}</button>
  <p role="status">{message}</p>
 </form>;
}
export function FlappyWeekCloseControl({week}:{week:string}){
 const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;const data=new FormData(event.currentTarget);setBusy(true);
  try{
   const response=await fetch("/api/admin/flappy-race/close-week",{method:"POST",credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(15000),headers:{"Content-Type":"application/json"},body:JSON.stringify({week:data.get("week"),confirmed:data.get("confirmed")==="on"})});
   if(!response.ok)throw new Error();setMessage("Semana cerrada. Clasificación congelada; sin premios ni pagos.");router.refresh();
  }catch{setMessage("Cierre no disponible: revisa resultados pendientes y plazo de liquidación.");}finally{setBusy(false);}
 }
 return <form onSubmit={submit}><h2>Cierre semanal manual</h2>
  <label>Lunes de la semana <input type="date" name="week" defaultValue={week} required /></label>
  <p>Solo tras finalizar la semana NY y el margen de 11 minutos, sin resultados pendientes. Conserva empates absolutos para revisión.</p>
  <label><input type="checkbox" name="confirmed" required /> Confirmo congelar esta clasificación sin asignar dinero.</label>
  <button className="button" type="submit" disabled={busy}>{busy?"Cerrando…":"CERRAR SEMANA"}</button><p role="status">{message}</p>
 </form>;
}
