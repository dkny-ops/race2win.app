import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Rules" };

export default function RulesPage() {
  return (
    <section className="page-section shell narrow legal-copy">
      <p className="eyebrow">RACE TO WIN · PLAYER RULES</p>
      <h1>Know the rules before you race.</h1>
      <p className="page-lede">Read the scoring format, fair-play requirements, and prize conditions below. Official standings and any awards remain subject to verification and human review.</p>
      <div className="notice">
        <h2>Cash-prize status</h2>
        <p>The current published Terms and Prizes page do not confirm an active cash-prize competition. No weekly cash amounts are confirmed here. Official prize rules, eligibility, amounts, dates, and payment conditions must be finalized and approved before prize entry opens. A leaderboard position or displayed amount alone does not guarantee an award or payment.</p>
      </div>
      <div className="rule-grid">
        <article>
          <h2>Official play</h2>
          <p>Only eligible, server-verified official Race To Win runs count toward tournament standings. Registration and successful sign-in are required for official sessions. Guest runs are for entertainment only: signing in later does not turn a guest score into an official result.</p>
        </article>
        <article>
          <h2>Weekly scoring</h2>
          <p>Each day, your seven highest eligible verified scores are added together. Your weekly total is the sum of those daily totals from Monday through Sunday, counting up to 49 runs. Days and weeks follow America/New_York, including daylight saving time. A new week starts Monday at 12:00 a.m. New York time; previous scores do not carry into the new week.</p>
        </article>
        <article>
          <h2>Tied totals</h2>
          <p>If weekly totals are tied, your eligible verified individual scores from that week are compared from highest to lowest: the highest score first, then the next highest, until a difference is found. An exact tie remains pending human review. Standings are provisional until the applicable review is complete.</p>
        </article>
        <article>
          <h2>Claims and payments</h2>
          <p>For a prize program that expressly adopts the Terms, the minimum withdrawal is US$10. Smaller valid awards accumulate in your eligible balance until that threshold is reached, subject to the announced program rules. Eligibility, results, and payment details require human approval. Payments are handled manually; neither a ranking nor a claim triggers automatic payment. No exact payment date is guaranteed while verification is pending.</p>
        </article>
        <article>
          <h2>Fair play</h2>
          <p>Cheating, bots or unfair automation, score manipulation, exploiting vulnerabilities, evading limits through account sharing, collusion, and fraudulent claims are prohibited. Suspected violations may place results or awards on hold. Confirmed intentional violations may lead to disqualification, forfeiture of ineligible awards, or permanent suspension after documented human review, subject to the Terms and applicable law. Players may request human reconsideration through an official support channel.</p>
        </article>
        <article>
          <h2>FlappyRace: practice only</h2>
          <p><strong>PRACTICE ONLY — no prizes and no official tournament.</strong> FlappyRace practice scores do not qualify for Race To Win standings, prize balances, or payments. Its official competition remains unavailable until game-specific authoritative server validation is completed, reviewed, and explicitly activated. Practice results will not be converted into verified tournament entries.</p>
        </article>
      </div>
      <p className="muted">These player rules summarize the current published format. Any future prize event must publish its official conditions before entry opens. Relevant changes will be announced before they apply.</p>
      <div className="button-row">
        <Link className="button button--secondary" href="/legal/terms">Terms &amp; Conditions</Link>
        <Link className="button button--secondary" href="/prizes">Prize status</Link>
      </div>
    </section>
  );
}
