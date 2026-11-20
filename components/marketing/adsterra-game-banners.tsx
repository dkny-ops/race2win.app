"use client";

import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 700px)";

type AdsterraGameBannersProps = Readonly<{ className?: string }>;

/**
 * A fixed-size Adsterra placement served from the isolated ads origin.
 * The provider never executes in racetowin.app and only one device-specific
 * document is loaded at a time.
 */
export function AdsterraGameBanners({ className = "" }: AdsterraGameBannersProps) {
  const [mobile, setMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  if (mobile === null) return null;

  const width = mobile ? 320 : 468;
  const height = mobile ? 50 : 60;
  const src = mobile
    ? "https://ads.racetowin.app/game-mobile"
    : "https://ads.racetowin.app/game-desktop";

  return (
    <aside className={`adsterra-game-banners ${className}`.trim()} aria-label="Advertisement">
      <iframe
        height={height}
        loading="eager"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts"
        scrolling="no"
        src={src}
        title="Advertisement"
        width={width}
      />
    </aside>
  );
}
