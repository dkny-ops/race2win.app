import type { FaqItem, PublicGame } from "@/types/public-types";

export const SITE_NAME = "Race To Win";
export const SITE_DESCRIPTION =
  "Play Race To Win and FlappyRace in official weekly tournaments.";

export const GAMES: PublicGame[] = [
  {
    slug: "race-to-win",
    title: "Race To Win",
    description: "Play the official Race To Win weekly competition.",
    status: "Official tournament active",
    accent: "blue",
  },
];

export const FAQS: FaqItem[] = [
  {
    question: "Is Race To Win live?",
    answer:
      "Yes. Race To Win is live with server-verified official tournament runs.",
  },
  {
    question: "How will the game work?",
    answer:
      "Play the driving game and submit eligible server-verified runs to the weekly leaderboard. Read the current rules for entry and scoring details.",
  },
  {
    question: "Will there be prizes?",
    answer:
      "Weekly prizes are $15 for first place, $3 for second, and $2 for third, subject to eligibility and manual administrator approval. Payments are never automatic.",
  },
  {
    question: "Will I need an account?",
    answer:
      "Sign in to participate in official competition. Guest play does not qualify for tournament prizes.",
  },
];
