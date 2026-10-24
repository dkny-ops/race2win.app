"use client";
import { useEffect, useState } from "react";
type Incident = {incident_id:string;occurred_at:string;route:string;reason:string;request_id:string;player_id:string|null;username:string|null;review_status:string;access_held:boolean};
export function Auth401Review() {
 const [items,setItems]=useState<Incident[]>([]);
 const [message,setMessage]=useState("Cargando...");
 const load=async()=>{
  try { const response=await fetch("/api/admin/auth-401-reviews",{cache:"no-store"}); if(!response.ok)throw Error();
   const body=await response.json();setItems(body.incidents);setMessage("");}
  catch {setMessage("No se pudo cargar la revisión.");}
 };
 useEffect(()=>{void load();},[]);
 async function authorize(item:Incident) {
  if(!item.player_id || !window.confirm("¿Autorizar nuevamente las partidas de "+(item.username||item.player_id)+"?"))return;
  try {const r=await fetch("/api/admin/auth-401-reviews",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerId:item.player_id})});
   const data=await r.json();if(!r.ok||!data.authorized)throw Error();setMessage("Acceso autorizado.");await load();}
  catch {setMessage("No se pudo autorizar el acceso.");}
 }
 return <div><button type="button" onClick={()=>void load()}>ACTUALIZAR</button><p role="status">{message}</p>
 {items.length===0&&!message?<p>No hay incidentes registrados.</p>:null}
 {items.map(item=><article key={item.incident_id} className="profile-card" style={{padding:16,marginTop:12,overflowWrap:"anywhere"}}>
 <strong>{item.username||"USUARIO NO IDENTIFICADO"}</strong>
 <p>Jugador: {item.player_id||"No identificado"}</p><p>Referencia: {item.incident_id}</p>
 <p>Fecha: {new Date(item.occurred_at).toLocaleString()}</p><p>Ruta: {item.route}</p>
 <p>Motivo: {item.reason}</p><p>Estado: {item.access_held?"PENDIENTE DE AUTORIZACIÓN":item.review_status}</p>
 {item.player_id&&item.access_held?<button type="button" onClick={()=>void authorize(item)}>AUTORIZAR JUEGO</button>:null}
 </article>)}</div>;
}
