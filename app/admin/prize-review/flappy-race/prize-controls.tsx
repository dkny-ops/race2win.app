"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Props={playerId:string;week:string;status:string;balanceCents:number;prizeCents:number;credited:boolean;winnerId?:string};
const money=(cents:number)=>"$"+(cents/100).toFixed(2);
export function FlappyPrizeControls({playerId,week,status,balanceCents,prizeCents,credited,winnerId}:Props) {
 const [note,setNote]=useState("");
 const [code,setCode]=useState("");
 const [identityChecked,setIdentityChecked]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const router=useRouter();
 function generateCode(){
  const value=new Uint32Array(1);crypto.getRandomValues(value);
  setCode(String(value[0]%1000000).padStart(6,"0"));
  setIdentityChecked(false);
  setMessage("Copia el código y envíalo personalmente por correo. El servidor no lo verifica ni lo guarda.");
 }
 async function act(action:"approved"|"rejected"|"needs_additional_review"|"allocate"|"paid"){
  if(busy||!note.trim())return;
  if(action==="allocate"&&(!identityChecked||status!=="approved"||credited))return;
  if(action==="paid"&&(!winnerId||balanceCents<2000||!credited||!identityChecked))return;
  const label=action==="allocate"?"ACREDITAR "+money(prizeCents)+" al balance del jugador":action==="paid"?"registrar que YA PAGASTE personalmente "+money(balanceCents)+" y dejar su balance en $0.00":action==="approved"?"aprobar al candidato":action==="rejected"?"rechazar al candidato":"solicitar revisión adicional";
  if(!window.confirm("¿Confirmas "+label+"? Esta acción queda registrada. El sistema nunca envía dinero."))return;
  setBusy(true);setMessage("");
  try{
   const endpoint=action==="paid"?"/api/admin/flappy-race/confirm-payment":"/api/admin/flappy-race/prizes";
   const payload=action==="paid"?{week,playerId,winnerId,note:note.trim(),confirmedPaidByOwner:true}:{week,playerId,action,note:note.trim()};
   const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store"});
   const body=await response.json().catch(()=>({message:"Respuesta no disponible"})) as {message?:string};
   if(!response.ok)throw Error(body.message||"No se pudo confirmar la operación.");
   setMessage(body.message||"Operación registrada.");
   setNote("");router.refresh();
  }catch(e){setMessage(e instanceof Error?e.message:"No se confirmó ningún cambio.");}
  finally{setBusy(false);}
 }
 const buttonStyle={width:"100%",minWidth:0,whiteSpace:"normal" as const,overflowWrap:"anywhere" as const,padding:"0.85rem"};
 return <section style={{display:"grid",gap:"1rem",margin:"1rem 0",minWidth:0}}>
  <h3>Verificación y premios</h3>
  <p><strong>Estado:</strong> {status==="approved"?"Aprobado":status==="rejected"?"Rechazado":status==="pending_review"?"Pendiente de revisión":"Revisión adicional"}</p>
  <div style={{display:"grid",gap:".6rem",padding:"1rem",border:"1px solid #405469",borderRadius:12}}>
   <strong>1. Verificación humana por correo</strong>
   <button type="button" className="button button--secondary" style={buttonStyle} onClick={generateCode}>GENERAR CÓDIGO</button>
   {code&&<><strong style={{fontSize:"1.5rem",letterSpacing:".2em"}}>{code}</strong><button type="button" className="button button--secondary" style={buttonStyle} onClick={()=>void navigator.clipboard.writeText(code).then(()=>setMessage("Código copiado."),()=>setMessage("Selecciona y copia el código manualmente."))}>COPIAR CÓDIGO</button></>}
   <label style={{display:"flex",gap:".6rem",alignItems:"flex-start"}}><input type="checkbox" checked={identityChecked} onChange={e=>setIdentityChecked(e.target.checked)}/> Confirmo que envié el código personalmente, el jugador me lo comunicó y lo comparé. Esta comprobación es manual.</label>
  </div>
  <div style={{display:"grid",gap:".6rem",padding:"1rem",border:"1px solid #405469",borderRadius:12}}>
   <strong>2. Revisión de partidas y premio</strong>
   <p>Premio: {money(prizeCents)} · Balance actual: {money(balanceCents)} · Tras acreditar: {money(balanceCents+(credited?0:prizeCents))}</p>
   <label>Motivo y evidencia de la decisión<textarea required rows={3} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} style={{display:"block",width:"100%",boxSizing:"border-box",marginTop:8}} /></label>
   <button type="button" className="button button--secondary" style={buttonStyle} disabled={busy||!note.trim()||status==="approved"||credited} onClick={()=>void act("approved")}>APROBAR CANDIDATO</button>
   <button type="button" className="button button--primary" style={buttonStyle} disabled={busy||!note.trim()||!identityChecked||status!=="approved"||credited} onClick={()=>void act("allocate")}>{credited?"PREMIO YA ACREDITADO":"VALIDAR Y ACREDITAR PREMIO"}</button>
  </div>
  <div style={{display:"grid",gap:".6rem",padding:"1rem",border:"1px solid #405469",borderRadius:12}}>
   <strong>3. Pago externo, únicamente cuando alcance $20</strong>
   <p>{balanceCents<2000?"Balance insuficiente: el premio se acumula hasta $20.":"Balance elegible: "+money(balanceCents)+". Paga personalmente antes de registrar el pago."}</p>
   <button type="button" className="button button--primary" style={buttonStyle} disabled={busy||!note.trim()||!identityChecked||!credited||!winnerId||balanceCents<2000} onClick={()=>void act("paid")}>PAGO EXITOSO · DEJAR BALANCE EN $0</button>
  </div>
  <details><summary>Otras decisiones administrativas</summary><div style={{display:"grid",gap:".6rem",marginTop:".7rem"}}>
   <button type="button" className="button button--secondary" style={buttonStyle} disabled={busy||!note.trim()||credited} onClick={()=>void act("needs_additional_review")}>REVISIÓN ADICIONAL</button>
   <button type="button" className="button button--secondary" style={buttonStyle} disabled={busy||!note.trim()||credited} onClick={()=>void act("rejected")}>RECHAZAR CANDIDATO</button>
  </div></details>
  {message&&<p role="status">{message}</p>}
 </section>;
}
