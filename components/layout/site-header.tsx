import Link from "next/link";
import { MobileMenu } from "./mobile-menu";
import { SiteLanguageSettings } from "./site-language-settings";
import { SITE_NAME } from "@/content/site";
import { PRIMARY_NAVIGATION, ROUTES } from "@/lib/routes";
import { ButtonLink } from "@/components/ui/button-link";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";

export async function SiteHeader() {
  let authenticated = false;
  let username: string | null = null;
  let isPrizeAdmin = false;

  try {
      const context = await getVerifiedUserContext();
      authenticated = Boolean(context);
      if (context) {
        const { data: profile } = await context.supabase
          .from("profiles")
          .select("username")
          .eq("user_id", context.userId)
          .maybeSingle<{ username: string | null }>();
        username = profile?.username ?? null;
        isPrizeAdmin = Boolean(await getAuthorizedPrizeAdmin());
      }
    } catch {
      // A transient auth-provider failure must not make the public site unavailable.
      authenticated = false;
    }
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="brand" href={ROUTES.home} aria-label={`${SITE_NAME}, home`}>
          <span className="brand-mark" aria-hidden="true">R</span>
          <span>{SITE_NAME}</span>
        </Link>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {PRIMARY_NAVIGATION.map((item) => (
            <Link key={item.href} href={item.href}>{item.label}</Link>
          ))}
          <SiteLanguageSettings desktop />
        </nav>
        <div className="header-actions">{isPrizeAdmin ? <Link href="/admin/prize-review">ADMIN PANEL</Link> : null}{authenticated ? <><Link className="profile-link" href={ROUTES.profile} aria-label="Open player profile"><span className="avatar-icon" aria-hidden="true">◉</span><span>{username ?? "PROFILE"}</span></Link><form action="/api/auth/sign-out" method="post"><button className="logout-button" type="submit">LOGOUT</button></form></> : <ButtonLink href={ROUTES.signIn} variant="text">SIGN IN</ButtonLink>}</div>
        <div className="mobile-header-actions">
          {!authenticated ? <Link href={ROUTES.signIn} className="mobile-header-sign-in" style={{ color: "#fff", fontWeight: 800, letterSpacing: ".09em", whiteSpace: "nowrap", fontSize: ".85rem" }}>SIGN IN</Link> : null}
        <MobileMenu>
          <nav aria-label="Mobile navigation">
            {PRIMARY_NAVIGATION.map((item) => (
              <Link key={item.href} href={item.href}>{item.label}</Link>
            ))}
            {isPrizeAdmin ? <Link href="/admin/prize-review">ADMIN PANEL</Link> : null}
            <SiteLanguageSettings />
            {authenticated ? <><Link className="profile-link" href={ROUTES.profile}><span className="avatar-icon" aria-hidden="true">◉</span><span>{username ?? "PROFILE"}</span></Link><form action="/api/auth/sign-out" method="post"><button className="logout-button" type="submit">LOGOUT</button></form></> : null}
          </nav>
        </MobileMenu>
        </div>
      </div>
    </header>
  );
}
