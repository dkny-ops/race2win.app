import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RaceToWinGame } from "@/components/game/race-to-win/race-to-win-game";
import { ROUTES } from "@/lib/routes";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Race To Win",
  description: "Play the Race To Win arcade highway run.",
};
export const dynamic = "force-dynamic";

export default async function RaceToWinGamePage() {
  const context = await getVerifiedUserContext();
  if (!context) redirect(`${ROUTES.signIn}?next=${encodeURIComponent(ROUTES.raceToWinGame)}`);
  const { data: profile, error } = await context.supabase.from("profiles").select("username").eq("user_id", context.userId).maybeSingle<{ username: string | null }>();
  if (error) throw new Error("Unable to verify player profile.");
  if (!profile?.username) redirect(ROUTES.profile);
  const authenticated = true;
  return (
    <main className="rtw-game-page">
      <nav className="rtw-game-page__navigation shell" aria-label="Game navigation">
        <Link className="rtw-page-control" href={ROUTES.home}>← BACK TO HOME</Link>
        <button type="button" className="rtw-page-control rtw-page-control--placeholder" disabled title="More games are not available yet">
          CHANGE GAME <small>COMING SOON</small>
        </button>
      </nav>
      <RaceToWinGame canStartOfficial={authenticated} />
    </main>
  );
}
