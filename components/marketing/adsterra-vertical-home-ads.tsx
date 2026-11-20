"use client";

import { useEffect, useState } from "react";

const DESKTOP_QUERY = "(min-width: 1001px)";

/**
 * Two desktop-only vertical placements served by the isolated advertising
 * origin. They live in normal Home content flow, never alongside a game
 * canvas or any player controls.
 */
export function AdsterraVerticalHomeAds() {
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  if (!desktop) return null;

  return (
    <section className="home-adsterra-vertical-ads" aria-label="Advertisement">
      <iframe
        height={300}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts"
        scrolling="no"
        src="https://ads.racetowin.app/home-vertical-300"
        title="Advertisement (160 by 300)"
        width={160}
      />
      <iframe
        height={600}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts"
        scrolling="no"
        src="https://ads.racetowin.app/home-vertical-600"
        title="Advertisement (160 by 600)"
        width={160}
      />
    </section>
  );
}
