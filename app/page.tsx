import { ButtonLink } from "@/components/ui/button-link";
import Image from "next/image";
import { FaqList } from "@/components/marketing/faq-list";
import { GameCard } from "@/components/marketing/game-card";
import { GameplayPreview } from "@/components/marketing/gameplay-preview";
import { PlayGameLink } from "@/components/game/race-to-win/play-game-link";
import { ShareCampaign } from "@/components/share/share-campaign";
import { FAQS, GAMES } from "@/content/site";
import { normalizeReferralCode } from "@/lib/competition/server";
import { readWeeklyShareLeaderboard } from "@/lib/competition/shares";
import { ROUTES } from "@/lib/routes";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  let username: string | null = null;
  let authenticated = false;
  try {
      const context = await getVerifiedUserContext();
      if (context) {
        authenticated = true;
        const { data: profile } = await context.supabase.from("profiles").select("username").eq("user_id", context.userId).maybeSingle<{ username: string | null }>();
        username = profile?.username ?? null;
      }
    } catch { username = null; }
  const referralCode = normalizeReferralCode((await searchParams).ref);
  let shareLeaderboard: Awaited<ReturnType<typeof readWeeklyShareLeaderboard>> | null = null;
  try { shareLeaderboard = await readWeeklyShareLeaderboard(); } catch { /* Render only a safe unavailable state. */ }
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
            <p className="eyebrow">THE RACE IS BUILDING</p>
            {username ? <p className="welcome-player">WELCOME, {username}</p> : null}
            <h1>RACE <em>TO WIN</em></h1>
            <p className="hero-lede">A new competitive racing experience is in development. One track. One chance to own the run.</p>
            <div className="button-row">
              <PlayGameLink>{authenticated ? "PLAY" : "PLAY AS GUEST"}</PlayGameLink>{authenticated ? <ButtonLink href={ROUTES.profile} variant="secondary">PROFILE</ButtonLink> : <ButtonLink href={`${ROUTES.signIn}?next=${encodeURIComponent(ROUTES.raceToWinGame)}`} variant="secondary">SIGN IN TO COMPETE</ButtonLink>}
            </div>
            <p className="play-note">Play for free without signing in. Sign in to save your scores, compete in tournaments and qualify for prizes. Guest scores are not saved.</p>
          </div>
        </div>
      </section>

      <GameplayPreview />

      <section className="section shell" aria-labelledby="how-title">
        <p className="eyebrow">THE FIRST DROP</p><div className="section-heading"><h2 id="how-title">Built for the players who never lift.</h2><p>Race To Win starts with one focused racing experience. Rules and access details will be published before launch.</p></div>
        <div className="steps">
        <article><span>01</span><h3>GET READY</h3><p>Explore the first local playable foundation and public information.</p></article><article><span>02</span><h3>GET ACCESS</h3><p>Player access details will be shared when the next phase is ready.</p></article><article><span>03</span><h3>RUN THE TRACK</h3><p>Official game rules and conditions will be visible before competition goes live.</p></article>
        </div>
      </section>

      <ShareCampaign authenticated={authenticated} referralCode={referralCode} tournamentWeek={shareLeaderboard?.tournamentWeek ?? null} entries={shareLeaderboard?.entries ?? []} unavailable={shareLeaderboard === null} />

      <section className="section section-tint" aria-labelledby="games-title">
        <div className="shell">
          <div className="section-heading section-heading--row"><div><p className="eyebrow">GAME 01</p><h2 id="games-title">One game. Full focus.</h2></div><ButtonLink href={ROUTES.games} variant="text">VIEW GAME <span aria-hidden="true">→</span></ButtonLink></div>
          <div className="game-grid">{GAMES.map((game) => <GameCard key={game.slug} game={game} />)}</div>
        </div>
      </section>

      <section className="section shell two-column" aria-labelledby="fair-title">
        <div><p className="eyebrow">BUILT TO COMPETE</p><h2 id="fair-title">The line will be clear.</h2></div><div><p>Rules, verification processes, and any applicable conditions will be communicated before official competition features become available.</p><ButtonLink href={ROUTES.rules} variant="secondary">READ THE RULES</ButtonLink></div>
      </section>

      <section className="section section-tint" id="access" aria-labelledby="faq-title"><div className="shell faq-layout"><div><p className="eyebrow">RACE CONTROL</p><h2 id="faq-title">What you need to know.</h2></div><FaqList items={FAQS} /></div></section>
    </>
  );
}
