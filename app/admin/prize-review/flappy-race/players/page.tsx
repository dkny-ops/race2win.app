import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { PlayersReview } from "../../players/review";
export const dynamic = "force-dynamic";
export const metadata = {title:"Admin · Jugadores Flappy Race",robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{q?:string|string[]}>}){
 if (!(await getAuthorizedPrizeAdmin())) notFound();
 const query=(await searchParams).q;
 const initialQuery=typeof query==="string"?query.slice(0,80):"";
 return <main className="page-section shell narrow flappy-admin-review">
   <h1 className="flappy-admin-page-title">BUSCAR JUGADOR</h1>
   <Link className="button button--secondary" href="/admin/prize-review/flappy-race">← VOLVER A FLAPPY</Link>
   <p style={{marginTop:"1rem"}}>Busca por username o ID. Solo se muestran las partidas, puntuaciones y alertas de Flappy Race. Los balances compartidos no se muestran.</p>
   <PlayersReview game="flappy-race" initialQuery={initialQuery}/>
 </main>;
}
