export const RACE_TO_WIN_GAME_SLUG = "race-to-win";
export const RACE_TO_WIN_GAME_SECTION_ID = "race-to-win-game";

export const ROUTES = {
  home: "/",
  howItWorks: "/how-it-works",
  games: "/games",
  prizes: "/prizes",
  rules: "/rules",
  faq: "/faq",
  terms: "/legal/terms",
  privacy: "/legal/privacy",
  raceToWinGame: `/games/${RACE_TO_WIN_GAME_SLUG}`,
  play: `/games/${RACE_TO_WIN_GAME_SLUG}`,
  signIn: "/sign-in",
  profile: "/profile",
} as const;

export const PRIMARY_NAVIGATION = [
  { href: ROUTES.howItWorks, label: "HOW IT WORKS" },
  { href: ROUTES.games, label: "GAME" },
  { href: ROUTES.prizes, label: "PRIZES" },
  { href: ROUTES.rules, label: "RULES" },
  { href: ROUTES.faq, label: "FAQ" },
] as const;
