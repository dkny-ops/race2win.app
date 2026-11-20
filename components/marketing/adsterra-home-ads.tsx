"use client";

type AdFrameProps = {
  className: string;
  height: number;
  src: string;
  title: string;
  width: number;
};

function AdFrame({ className, height, src, title, width }: AdFrameProps) {
  return (
    <iframe
      className={className}
      height={height}
      loading="lazy"
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin"
      scrolling="no"
      src={src}
      title={title}
      width={width}
    />
  );
}

/**
 * Home-only ad placements. Adsterra runs on a separate Vercel origin
 * without application cookies, Supabase credentials, or access to the game.
 * Never load provider scripts directly on the main application origin.
 */
export function AdsterraHomeAds() {
  return (
    <section className="home-adsterra-ads" aria-label="Advertisement">
      <AdFrame className="home-adsterra-ads__display home-adsterra-ads__display--desktop" height={90} src="https://ads.racetowin.app/desktop/" title="Advertisement (desktop)" width={728} />
      <AdFrame className="home-adsterra-ads__display home-adsterra-ads__display--mobile" height={250} src="https://ads.racetowin.app/mobile/" title="Advertisement (mobile)" width={300} />
    </section>
  );
}
