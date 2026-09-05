import Link from "next/link";
import { SITE_NAME } from "@/content/site";
import { PRIMARY_NAVIGATION, ROUTES } from "@/lib/routes";
import { ButtonLink } from "@/components/ui/button-link";
import { PlayGameLink } from "@/components/game/race-to-win/play-game-link";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export async function SiteHeader() {
  let authenticated = false;
  let username: string | null = null;

  if (isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getClaims();
      authenticated = Boolean(data?.claims?.sub);
      if (authenticated) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("user_id", data?.claims?.sub ?? "")
          .maybeSingle<{ username: string | null }>();
        username = profile?.username ?? null;
      }
    } catch {
      // A transient auth-provider failure must not make the public site unavailable.
      authenticated = false;
    }
  }
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="brand" href={ROUTES.home} aria-label={`${SITE_NAME}, home`}>
          <span className="brand-mark" aria-hidden="true">R</span>
          <span className="brand-copy"><span>{SITE_NAME}</span><span className="brand-signature">DKNY</span></span>
        </Link>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {PRIMARY_NAVIGATION.map((item) => (
            <Link key={item.href} href={item.href}>{item.label}</Link>
          ))}
        </nav>
        <div className="header-actions">{authenticated ? <><Link className="profile-link" href={ROUTES.profile} aria-label="Open player profile"><span className="avatar-icon" aria-hidden="true">◉</span><span>{username ?? "PROFILE"}</span></Link><form action="/api/auth/sign-out" method="post"><button className="logout-button" type="submit">LOGOUT</button></form></> : <ButtonLink href={ROUTES.signIn} variant="text">SIGN IN</ButtonLink>}<PlayGameLink className="header-play">PLAY</PlayGameLink></div>
        <details className="mobile-menu">
          <summary aria-label="Open menu">MENU</summary>
          <nav aria-label="Mobile navigation">
            {PRIMARY_NAVIGATION.map((item) => (
              <Link key={item.href} href={item.href}>{item.label}</Link>
            ))}
            {authenticated ? <><Link className="profile-link" href={ROUTES.profile}><span className="avatar-icon" aria-hidden="true">◉</span><span>{username ?? "PROFILE"}</span></Link><form action="/api/auth/sign-out" method="post"><button className="logout-button" type="submit">LOGOUT</button></form></> : <Link href={ROUTES.signIn}>SIGN IN</Link>}<PlayGameLink variant="text" className="mobile-play-link">PLAY</PlayGameLink>
          </nav>
        </details>
      </div>
    </header>
  );
}
