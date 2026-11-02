import type { Metadata } from "next";
import Link from "next/link";
import { FlappyRacePage } from "@/components/game/flappy-race-page";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";

export const metadata: Metadata = { title: "Flappy Race | Race To Win", description: "Play Flappy Race, a free timing-based browser arcade game. Avoid obstacles, improve your score and explore weekly rankings." };

export const dynamic = "force-dynamic";
export default async function Page() {
 const [context, owner] = await Promise.all([
   getVerifiedUserContext().catch(() => null),
   getAuthorizedPrizeAdmin().catch(() => null),
 ]);
 return <main className="flappy-game-page page-section shell narrow" style={{ textAlign: "center", paddingTop: "calc(82px + .75rem)" }}>
  {owner ? <div style={{display:"flex",justifyContent:"center",marginBottom:".75rem"}}>
    <Link className="button button--primary" href="/admin/prize-review/flappy-race">ADMINISTRADOR · REVISAR PARTIDAS →</Link>
  </div> : null}
  <FlappyRacePage authenticated={Boolean(context)} />
 </main>;
}
