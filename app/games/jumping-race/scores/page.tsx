import Link from "next/link";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jumping Race Score", robots: { index: false, follow: false } };

export default async function JumpingRaceScoresPage() {
  const signedIn = Boolean(await getVerifiedUserContext());
  return <section className="page-section scores-page jumping-scores-page">
    <div className="shell">
      <Link href="/games/jumping-race" className="button button--secondary" style={{ marginBottom: "1.25rem" }}>← BACK TO JUMPING RACE</Link>
      <p className="eyebrow">JUMPING RACE · SCORE</p>
      <h1>WORLD SCORE</h1>
      <p className="page-lede">Hourly score rankings will show verified official results only. Practice and guest runs never appear here.</p>

      <section className="scores-panel scores-ranking-panel" aria-labelledby="jumping-score-title">
        <div className="scores-ranking-title"><span className="scores-ranking-symbol" aria-hidden="true">★</span><div><p className="eyebrow">JUMPING RACE · CURRENT HOUR</p><h2 id="jumping-score-title">WORLD SCORE</h2></div></div>
        <p className="scores-ranking-subtitle">TOP 3 VERIFIED SCORES · HOURLY TOTAL · UTC</p>
        <p className="scores-message" role="status">Official Jumping Race scoring is not active yet. Verified results will appear here when competition launches.</p>
        <div className="scores-table scores-ranking-table jumping-scores-table" role="table" aria-label="Jumping Race world score">
          <div className="scores-table__header" role="row"><span role="columnheader">POSITION</span><span role="columnheader">PLAYER</span><span role="columnheader">TOP 1</span><span role="columnheader">TOP 2</span><span role="columnheader">TOP 3</span><span role="columnheader">TOTAL</span></div>
        </div>
        <div className="scores-pagination"><button className="button button--secondary" type="button" disabled>PREVIOUS</button><span aria-live="polite">PAGE 1</span><button className="button button--secondary" type="button" disabled>NEXT</button></div>
      </section>

      <aside className="jumping-scores-session" aria-live="polite">{signedIn ? "SIGNED IN · Official scoring is not active yet." : "GUEST MODE · Sign in when official competition opens."}</aside>
    </div>
  </section>;
}

