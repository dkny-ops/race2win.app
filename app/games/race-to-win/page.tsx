import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { MobileMenu } from "@/components/layout/mobile-menu";
import { SiteLanguageSettings } from "@/components/layout/site-language-settings";
import { PRIMARY_NAVIGATION } from "@/lib/routes";
import { redirect } from "next/navigation";
import { RaceToWinGame } from "@/components/game/race-to-win/race-to-win-game";
import { ROUTES } from "@/lib/routes";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Race To Win",
  description: "Play the Race To Win arcade highway run.",
};
export const dynamic = "force-dynamic";

function GameNavigation() {
  return <nav className="rtw-game-page__navigation shell" aria-label="Game navigation">
    <Link className="rtw-page-control" href={ROUTES.home}><span className="rtw-back-desktop-label">← BACK TO HOME</span><span className="rtw-back-mobile-label"><Image src="/images/back-home-blue.svg" alt="Home" width={50} height={50} unoptimized /></span></Link>
    <div className="rtw-game-mobile-menu"><MobileMenu><nav aria-label="Game menu">{PRIMARY_NAVIGATION.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}<SiteLanguageSettings /></nav></MobileMenu></div>
  </nav>;
}

export default async function RaceToWinGamePage() {
  const context = await getVerifiedUserContext();
  if (!context) return <main className="rtw-game-page"><Link className="rtw-game-page__brand-banner" href={ROUTES.home} aria-label="Back to Home"><Image src="/images/%20%20%20%20race-to-win-logo-banner.webp..PNG" alt="Race To Win" width={1536} height={512} unoptimized priority /></Link><RaceToWinGame canStartOfficial={false} /><GameNavigation /></main>;
  const { data: profile, error } = await context.supabase.from("profiles").select("username").eq("user_id", context.userId).maybeSingle<{ username: string | null }>();
  if (error) throw new Error("Unable to verify player profile.");
  if (!profile?.username) redirect(ROUTES.profile);
  const { data: consent, error: consentError } = await createAdminClient().from("player_terms_acceptances").select("terms_version").eq("player_id", context.userId).maybeSingle();
  if (consentError) throw new Error("Unable to verify tournament eligibility.");
  if (consent?.terms_version !== "2026-10-18") redirect("/terms/accept");
  const authenticated = true;
  return (
    <main className="rtw-game-page">
      <Link className="rtw-game-page__brand-banner" href={ROUTES.home} aria-label="Back to Home"><Image src="/images/%20%20%20%20race-to-win-logo-banner.webp..PNG" alt="Race To Win" width={1536} height={512} unoptimized priority /></Link>
      <RaceToWinGame canStartOfficial={authenticated} />
      <GameNavigation />
    </main>
  );
}
