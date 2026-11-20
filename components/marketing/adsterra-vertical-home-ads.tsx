"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const DESKTOP_QUERY = "(min-width: 1001px)";
const SIDE_AD_PATHS = new Set([
  "/games", "/scores", "/leaderboard", "/profile",
  "/games/jumping-race/scores",
  "/games/flappy-race/how-to-play", "/games/race-to-win/how-to-play",
  "/rules", "/faq", "/about", "/contact",
  "/legal/terms", "/legal/privacy", "/legal/cookies",
]);

/** Desktop-only side placements; provider scripts remain on ads.racetowin.app. */
export function AdsterraVerticalPageAds({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const eligible = SIDE_AD_PATHS.has(pathname.replace(/\/$/, "") || "/");
  if (!eligible || !desktop) return <>{children}</>;

  return (
    <div className="public-vertical-ad-layout">
      <aside className="public-vertical-ad-layout__side" aria-label="Advertisement">
        <iframe height={600} loading="lazy" referrerPolicy="no-referrer"
          sandbox="allow-scripts" scrolling="no"
          src="https://ads.racetowin.app/home-vertical-600"
          title="Advertisement (160 by 600)" width={160} />
      </aside>
      <div className="public-vertical-ad-layout__content">{children}</div>
      <aside className="public-vertical-ad-layout__side" aria-label="Advertisement">
        <iframe height={300} loading="lazy" referrerPolicy="no-referrer"
          sandbox="allow-scripts" scrolling="no"
          src="https://ads.racetowin.app/home-vertical-300"
          title="Advertisement (160 by 300)" width={160} />
      </aside>
    </div>
  );
}
