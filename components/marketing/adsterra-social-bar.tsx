"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const SOCIAL_BAR_PATHS = new Set(["/", "/scores", "/leaderboard", "/games/jumping-race/scores", "/games/flappy-race/scores"]);

export function AdsterraSocialBar({ position = "bottom" }: { position?: "top" | "bottom" }) {
  const pathname = usePathname();
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 701px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const path = pathname.replace(/\/$/, "") || "/";
  if (desktop === null || !SOCIAL_BAR_PATHS.has(path)) return null;
  const top = desktop && path === "/";
  if ((position === "top") !== top) return null;
  return (
    <section aria-label="Advertisement" style={{width:"100%",maxWidth:728,margin:"12px auto",textAlign:"center"}}>
      <iframe
        title="Social Bar advertisement"
        src="https://ads.racetowin.app/social-bar/"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        style={{display:"block",width:"100%",height:top?100:300,border:0}}
      />
    </section>
  );
}
