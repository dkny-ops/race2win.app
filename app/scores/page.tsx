import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MyRaceStats } from "@/components/scores/my-race-stats";
import { ROUTES } from "@/lib/routes";
import { getVerifiedUserContext } from "@/lib/supabase/server";
export const metadata: Metadata = { title: "My Race Stats" };
export default async function ScoresPage() { if (!(await getVerifiedUserContext())) redirect(ROUTES.signIn); return <section className="page-section scores-page"><div className="shell"><p className="eyebrow">RACE TO WIN · DISPLAY ONLY</p><h1>MY RACE STATS</h1><p className="page-lede">Official totals and position are calculated on the server from validated runs only.</p><MyRaceStats /></div></section>; }
