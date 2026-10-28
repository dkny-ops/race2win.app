import type { Metadata } from "next";
import { FlappyGuide } from "@/components/marketing/game-guides";
import { FlappyRacePage } from "@/components/game/flappy-race-page";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Flappy Race | Race To Win", description: "Play the free Flappy Race mini game." };

export const dynamic = "force-dynamic";
export default async function Page() {
 const authenticated = Boolean(await getVerifiedUserContext().catch(() => null));
 return <main className="page-section shell narrow" style={{ textAlign: "center", paddingTop: "calc(82px + .75rem)" }}>
  <FlappyRacePage authenticated={authenticated} />
  <FlappyGuide />
 </main>;
}
