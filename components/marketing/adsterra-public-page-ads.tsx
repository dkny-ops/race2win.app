"use client";

import { usePathname } from "next/navigation";
import { AdsterraGameBanners } from "@/components/marketing/adsterra-game-banners";

// Public pages without existing placements. Never display in admin, auth or gameplay.
const AD_PATHS = new Set([
  "/games", "/scores", "/leaderboard", "/profile",
  "/games/jumping-race/scores",
  "/games/flappy-race/how-to-play", "/games/race-to-win/how-to-play",
  "/rules", "/faq", "/about", "/contact",
  "/legal/terms", "/legal/privacy", "/legal/cookies",
]);

export function AdsterraPublicPageAds({ position }: { position: "top" | "bottom" }) {
  const pathname = usePathname();
  if (!AD_PATHS.has(pathname.replace(/\/$/, "") || "/")) return null;
  return <AdsterraGameBanners className={`adsterra-public-page-ads adsterra-public-page-ads--${position}`} />;
}
