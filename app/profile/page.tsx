import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClaimablePrizes } from "@/components/prizes/claimable-prizes";
import { ProfileForm } from "./profile-form";
import { ROUTES } from "@/lib/routes";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const context = await getVerifiedUserContext();
  if (!context) redirect(ROUTES.signIn);

  return <section className="page-section player-profile-page"><div className="narrow"><div className="player-profile-heading"><p className="eyebrow">RACE CONTROL</p><h1>PLAYER PROFILE</h1><p className="page-lede">Manage your public player identity and private payout email.</p></div><div className="profile-stack"><ProfileForm nextPath={ROUTES.raceToWinGame} /><ClaimablePrizes /></div></div></section>;
}
