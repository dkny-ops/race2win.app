import { ButtonLink } from "@/components/ui/button-link";
import Image from "next/image";
import { FaqList } from "@/components/marketing/faq-list";
import { PlayGameLink } from "@/components/game/race-to-win/play-game-link";
import { FAQS } from "@/content/site";
import { ROUTES } from "@/lib/routes";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";

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
  return (
    <>
      <section className="hero">
        <div className="hero-visual" aria-hidden="true">
          <Image
            src="/images/race-to-win-hero.png"
            alt=""
            fill
            priority
            sizes="100vw"
          />
        </div>
        <div className="shell hero-grid">
          <div className="hero-copy">
            {username ? <p className="hero-player-name">{username}</p> : null}
            <h1>RACE <em>TO WIN</em></h1>
            <p className="hero-lede">A new competitive racing experience is in development. One track. One chance to own the run.</p>
            <div className="button-row">
              <PlayGameLink>PLAY</PlayGameLink>{owner ? <ButtonLink href="/admin/prize-review" variant="secondary">ADMIN</ButtonLink> : null}{authenticated ? <ButtonLink href={ROUTES.profile} variant="secondary">PROFILE</ButtonLink> : <ButtonLink href={ROUTES.signIn} variant="secondary">SIGN IN</ButtonLink>}
            </div>
            <p className="play-note">PLAY opens the Race To Win game.</p>
          </div>
        </div>
      </section>

      <section className="section shell two-column" aria-labelledby="fair-title">
        <div><p className="eyebrow">BUILT TO COMPETE</p><h2 id="fair-title">The line will be clear.</h2></div><div><p>Rules, verification processes, and any applicable conditions will be communicated before official competition features become available.</p><ButtonLink href={ROUTES.rules} variant="secondary">READ THE RULES</ButtonLink></div>
      </section>

      <section className="section section-tint" id="access" aria-labelledby="faq-title"><div className="shell faq-layout"><div><p className="eyebrow">RACE CONTROL</p><h2 id="faq-title">What you need to know.</h2></div><FaqList items={FAQS} /></div></section>
    </>
  );
}
