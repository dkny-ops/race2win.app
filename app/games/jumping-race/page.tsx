import Link from "next/link";
import Image from "next/image";
import { canAccessGamePreview } from "@/lib/security/game-preview-access";
import { JumpingRaceGame } from "@/components/game/jumping-race-game";
export const dynamic = "force-dynamic";
export const metadata = {title:"Jumping Race · Coming Soon",robots:{index:false,follow:false}};
export default async function JumpingRacePage(){
 const allowed=await canAccessGamePreview("jumping-race");
 return <main className="page-section shell" style={{paddingTop:"7rem",minHeight:"70vh",textAlign:"center"}}>
  <p className="eyebrow">JUMPING RACE · COMING SOON</p>
  <h1 style={{maxWidth:850,margin:"0 auto 1.5rem"}}><Image src="/games/jumping-race/jumping-race-logo.svg" alt="Jumping Race" width={1200} height={260} unoptimized priority style={{width:"100%",height:"auto"}} /></h1>
  {allowed?<JumpingRaceGame/>:<>
   <p>Este juego se encuentra en desarrollo y pruebas privadas.</p>
   <p>Estará disponible cuando finalice su preparación.</p>
  </>}
  <div style={{marginTop:20}}><Link className="button button--secondary" href="/">← VOLVER A HOME</Link></div>
 </main>;
}
