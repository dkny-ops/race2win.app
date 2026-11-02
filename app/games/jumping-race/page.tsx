import Link from "next/link";
import { canAccessGamePreview } from "@/lib/security/game-preview-access";
export const dynamic = "force-dynamic";
export const metadata = {title:"Jumping Race · En pruebas",robots:{index:false,follow:false}};
export default async function JumpingRacePage(){
 const allowed=await canAccessGamePreview("jumping-race");
 return <main className="page-section shell narrow" style={{paddingTop:"7rem",minHeight:"70vh",textAlign:"center"}}>
  <p className="eyebrow">JUMPING RACE · PRÓXIMAMENTE</p>
  <h1>JUMPING <em>RACE</em></h1>
  {allowed ? <>
   <p>ACCESO PRIVADO AUTORIZADO</p>
   <p>Área de desarrollo de Jumping Race. El juego todavía no está implementado. Aquí aparecerá la versión aprobada para pruebas.</p>
   <p>Las pruebas no generan puntuaciones oficiales ni premios.</p>
  </> : <>
   <p>Este juego se encuentra en desarrollo y pruebas privadas.</p>
   <p>Estará disponible cuando finalice su preparación.</p>
  </>}
  <Link className="button button--secondary" href="/">← VOLVER A HOME</Link>
 </main>;
}
