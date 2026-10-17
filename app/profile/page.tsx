import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClaimablePrizes } from "@/components/prizes/claimable-prizes";
import { ProfileForm } from "./profile-form";
import { ROUTES } from "@/lib/routes";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const context = await getVerifiedUserContext();
  if (!context) redirect(ROUTES.signIn);
  const next = (await searchParams).next === ROUTES.raceToWinGame ? ROUTES.raceToWinGame : ROUTES.raceToWinGame;

  return <section className="page-section"><div className="narrow"><p className="eyebrow">RACE CONTROL</p><h1>PLAYER PROFILE</h1><p className="page-lede">Manage your public player identity and private payout email.</p><div className="profile-stack"><ProfileForm nextPath={next} /><ClaimablePrizes /></div></div></section>;
}
