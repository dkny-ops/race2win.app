"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { SITE_NAME } from "@/content/site";
import { ROUTES } from "@/lib/routes";

export function FlappyAwareBrand() {
  const pathname = usePathname();
  const isFlappyAdmin = pathname.startsWith("/admin/prize-review/flappy-race");
  return <Link className="brand" href={ROUTES.home} aria-label={isFlappyAdmin ? "Flappy Race, home" : `${SITE_NAME}, home`}>
    {isFlappyAdmin ? <span style={{fontWeight:900,letterSpacing:".08em",color:"#5bf5a1",fontSize:"clamp(1.1rem,4vw,1.8rem)"}}>FLAPPY RACE</span> : <>
      <Image className="site-brand-banner" src="/images/%20%20%20%20race-to-win-logo-banner.webp..PNG" alt="Race To Win" width={1536} height={512} unoptimized priority />
      <span className="site-brand-flappy">FLAPPY RACE</span>
    </>}
  </Link>;
}
