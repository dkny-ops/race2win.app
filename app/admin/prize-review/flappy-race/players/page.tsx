import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { PlayersReview } from "../../players/review";
export const dynamic = "force-dynamic";
export const metadata = {title:"Admin · Jugadores Flappy Race",robots:{index:false,follow:false}};
export default async function Page(){
 if (!(await getAuthorizedPrizeAdmin())) notFound();
 return <main className="page-section shell narrow flappy-admin-review">
   <div className="flappy-admin-banner"><p className="eyebrow">OWNER REVIEW · FLAPPY RACE</p><h1>BUSCAR JUGADOR</h1></div>
   <Link className="button button--secondary" href="/admin/prize-review/flappy-race">← VOLVER A FLAPPY</Link>
   <p style={{marginTop:"1rem"}}>Busca por username o ID. Solo se muestran las partidas, puntuaciones y alertas de Flappy Race. Los balances compartidos no se muestran.</p>
   <PlayersReview game="flappy-race"/>
 </main>;
}
