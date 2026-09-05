import type { FaqItem, PublicGame } from "@/types/public-types";

export const SITE_NAME = "Race To Win";
export const SITE_DESCRIPTION =
  "A high-speed competitive racing experience in development.";

export const GAMES: PublicGame[] = [
  {
    slug: "race-to-win",
    title: "Race To Win",
    description: "A playable arcade highway run. Official competition features will arrive in a later phase.",
    status: "Playable foundation",
    accent: "blue",
  },
];

export const FAQS: FaqItem[] = [
  {
    question: "Is Race To Win live yet?",
    answer:
      "The local playable foundation is available now. Official competition features will be announced separately.",
  },
  {
    question: "How will the game work?",
    answer:
      "Official rules and entry requirements will be published before competitive features become available.",
  },
  {
    question: "Will there be prizes?",
    answer:
      "Prize structure, eligibility, and verification are not defined yet. No amounts or terms have been announced.",
  },
  {
    question: "Will I need an account?",
    answer:
      "Player accounts are available for sign-in and profile setup. Game access details will be shared before launch.",
  },
];
