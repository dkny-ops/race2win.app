import { LocalizedHome } from "@/components/marketing/localized-home";
import { ROUTES } from "@/lib/routes";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  let username: string | null = null;
  let authenticated = false;
  let playHref: string = `${ROUTES.signIn}?next=${encodeURIComponent(ROUTES.raceToWinGame)}`;
  const owner = await getAuthorizedPrizeAdmin().catch(() => null);
  try {
      const context = await getVerifiedUserContext();
      if (context) {
        authenticated = true;
        const { data: profile } = await context.supabase.from("profiles").select("username").eq("user_id", context.userId).maybeSingle<{ username: string | null }>();
        username = profile?.username ?? null;
        playHref = username ? ROUTES.play : ROUTES.profile;
      }
    } catch { username = null; }
  return <LocalizedHome username={username} authenticated={authenticated} owner={Boolean(owner)} playHref={playHref} />;
}
