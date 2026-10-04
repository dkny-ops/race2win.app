import type { Metadata } from "next";
import { MyRaceStats } from "@/components/scores/my-race-stats";
import { GuestRaceStats } from "@/components/scores/guest-race-stats";
import { BackLink } from "@/components/navigation/back-link";
import { ROUTES } from "@/lib/routes";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";
export const metadata: Metadata = { title: "My Race Stats" };
export default async function ScoresPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const context = await getVerifiedUserContext();
  const from = (await searchParams).from;
  const backHref = from === "play" ? ROUTES.play : ROUTES.home;
  return <section className="page-section scores-page"><div className="shell"><BackLink href={backHref} /><p className="eyebrow">RACE TO WIN · DISPLAY ONLY</p><h1>MY RACE STATS</h1><p className="page-lede">{context ? "Official totals and position are calculated on the server from validated runs only." : "Guest scores are visual, memory-only results. Sign in before a new run to save validated scores and qualify for the tournament."}</p>{context ? <MyRaceStats /> : <GuestRaceStats tournamentWeek={currentNewYorkTournamentWeek()} />}</div></section>;
}
