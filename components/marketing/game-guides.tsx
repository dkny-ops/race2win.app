import type { ReactNode } from "react";

/** Shared disclosure for game instructions. Use for every new game. */
export function GameInfoButton({ children }: { children: ReactNode }) {
 return <details className="rtw-game-info"><summary aria-label="Game information and how to play"><span aria-hidden="true">ⓘ</span><span>HOW TO PLAY</span></summary><div className="rtw-game-info__content">{children}</div></details>;
}

export function RaceGuide() {
 return <section className="page-section shell narrow legal-copy" aria-labelledby="race-guide-heading">
  <h2 id="race-guide-heading">How to play Race To Win</h2>
  <p>Race To Win is a free browser-based highway driving challenge. Guide your car between traffic vehicles and stay on the road as the pace increases. Each run is a test of timing, concentration, and lane selection. The road keeps moving, so watch the cars ahead rather than waiting until an obstacle is directly in front of you.</p>
  <h3>Controls and strategy</h3>
  <p>On a computer, use the left and right arrow keys or A and D to change lanes. On touchscreens, swipe left or right. Plan one lane change at a time and leave room to react to traffic. A collision ends the run unless a currently available continuation option applies. The game displays live progress and a provisional score while you play.</p>
  <h3>Official weekly competition</h3>
  <p>Guest play is for entertainment. To enter the official ranking, sign in and start an eligible official session. The server checks the session and determines which results count. For Race To Win, up to seven highest eligible verified scores per day count toward the weekly total, from Monday through Sunday in New York time. The weekly leaderboard and any prizes remain subject to verification and the published rules.</p>
  <p>Playing is free; there is no entry fee or requirement to deposit money. A displayed score or position does not guarantee a cash award. Prize eligibility depends on the official rules, location, age, fraud review, and manual approval. Eligible balances accumulate until the shared minimum withdrawal of US$20 is reached. Read the <a href="/rules">player rules</a> and <a href="/legal/terms">terms</a> before competing.</p>
 </section>;
}
export function FlappyGuide() {
 return <section className="legal-copy" aria-labelledby="flappy-guide-heading" style={{textAlign:"left",marginTop:"2rem"}}>
  <h2 id="flappy-guide-heading">How to play Flappy Race</h2>
  <p>Flappy Race is a free browser arcade game built around precise timing. Keep your character moving through the course and avoid obstacles. Short, deliberate inputs work better than frantic tapping: observe the next opening, adjust your timing, and try to build a consistent run. You can play on a phone or computer without installing an app.</p>
  <h3>Scores and rankings</h3>
  <p>The game displays a weekly ranking separate from Race To Win. Eligible official sessions require an account and server-side validation. Scores may be held for review before they appear in official results. A high score alone does not automatically qualify for a prize or authorize payment. Check the leaderboard for the current competition status.</p>
  <h3>Fair play and prizes</h3>
  <p>Playing is free and does not require a deposit or wager. Automated play, manipulated inputs, and falsified results are prohibited. Any cash prize requires eligibility checks and human review. Approved awards in the shared wallet accumulate toward a US$20 minimum withdrawal; payments are never automatic. The <a href="/rules">rules</a> and <a href="/legal/terms">terms</a> explain the conditions and restrictions.</p>
 </section>;
}
