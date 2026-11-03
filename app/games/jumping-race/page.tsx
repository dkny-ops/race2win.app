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
  <h1 className="jumping-race-game-banner"><Link href="/" aria-label="Volver a Home" style={{display:"block"}}><Image src="/games/jumping-race/22170F02-4064-4DF7-BF86-DB04AACC04E3.png" alt="Jumping Race — volver a Home" width={1536} height={512} unoptimized priority style={{width:"100%",height:"auto",objectFit:"contain"}} /></Link></h1>
  {allowed?<JumpingRaceGame/>:<>
   <p>Este juego se encuentra en desarrollo y pruebas privadas.</p>
   <p>Estará disponible cuando finalice su preparación.</p>
  </>}
  <div style={{marginTop:20}}><Link className="button button--secondary" href="/">← VOLVER A HOME</Link></div>
 </main>;
}
