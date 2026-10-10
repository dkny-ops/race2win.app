import type { Metadata } from "next";
import { LeaderboardTable } from "@/components/scores/leaderboard-table";
import { BackLink } from "@/components/navigation/back-link";
import { ROUTES } from "@/lib/routes";
export const metadata: Metadata = { title: "Weekly Leaderboard" };
export default function LeaderboardPage() { return <section className="page-section scores-page"><div className="shell"><BackLink href={ROUTES.home} /><p className="eyebrow">RACE TO WIN</p><h1>LEADERBOARD</h1><p className="page-lede">Weekly positions and totals are calculated server-side from validated official runs.</p><LeaderboardTable /></div></section>; }
