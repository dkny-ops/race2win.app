import type { Metadata } from "next";
import Link from "next/link";
import { FlappyRacePage } from "@/components/game/flappy-race-page";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Flappy Race | Race To Win", description: "Play the free Flappy Race mini game." };

export const dynamic = "force-dynamic";
export default async function Page() {
 const authenticated = Boolean(await getVerifiedUserContext().catch(() => null));
 return <main className="page-section shell narrow" style={{ textAlign: "center" }}>
  <nav style={{ textAlign: "left", marginBottom: "1rem" }}><Link href="/" className="button button--secondary">← BACK TO HOME</Link></nav>
  <h1>FLAPPY RACE</h1>
  <FlappyRacePage authenticated={authenticated} />
 </main>;
}
