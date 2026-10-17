import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LeaderboardTable } from "@/components/scores/leaderboard-table";
import { ROUTES } from "@/lib/routes";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Race To Win Rankings" };

export default async function ScoresPage() {
  if (!(await getVerifiedUserContext())) redirect(ROUTES.signIn);
  return <section className="page-section scores-page">
    <div className="shell">
      <Link href={ROUTES.raceToWinGame} className="button button--secondary" style={{ marginBottom: "1.25rem" }}>← BACK TO GAME</Link>
      <p className="eyebrow">RACE TO WIN · VERIFIED RESULTS</p>
      <h1>RACE RANKINGS</h1>
      <p className="page-lede">Your seven best verified runs per day count toward the weekly total. The world ranking uses the same verified weekly totals.</p>
      <LeaderboardTable />
    </div>
  </section>;
}
