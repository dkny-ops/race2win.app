"use client";

import { usePathname } from "next/navigation";

const SOCIAL_BAR_PATHS = new Set(["/", "/scores", "/leaderboard", "/games/jumping-race/scores", "/games/flappy-race/scores"]);

export function AdsterraSocialBar() {
  const pathname = usePathname();
  if (!SOCIAL_BAR_PATHS.has(pathname.replace(/\/$/, "") || "/")) return null;
  return (
    <section aria-label="Advertisement" style={{width:"100%",maxWidth:728,margin:"12px auto",textAlign:"center"}}>
      <iframe
        title="Social Bar advertisement"
        src="https://ads.racetowin.app/social-bar/"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        style={{display:"block",width:"100%",height:300,border:0}}
      />
    </section>
  );
}
