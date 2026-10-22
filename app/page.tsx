import { LocalizedHome } from "@/components/marketing/localized-home";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  let username: string | null = null;
  let authenticated = false;
  const owner = await getAuthorizedPrizeAdmin().catch(() => null);
  try {
      const context = await getVerifiedUserContext();
      if (context) {
        authenticated = true;
        const { data: profile } = await context.supabase.from("profiles").select("username").eq("user_id", context.userId).maybeSingle<{ username: string | null }>();
        username = profile?.username ?? null;
      }
    } catch { username = null; }
  return <LocalizedHome username={username} authenticated={authenticated} owner={Boolean(owner)} />;
}
