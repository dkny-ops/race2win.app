import Image from "next/image";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";

type GameplayPreviewProps = {
  /** A self-hosted capture can be supplied once a real game recording exists. */
  videoSrc?: string;
};

/**
 * Presentation-only link. It intentionally creates no game session and makes
 * no API or Supabase call; actual play starts only on the dedicated route.
 */
export function GameplayPreview({ videoSrc }: GameplayPreviewProps) {
  return (
    <section id="gameplay-preview" className="gameplay-preview shell" aria-label="Race To Win gameplay preview">
      <Link className="gameplay-preview__link" href={ROUTES.raceToWinGame} aria-label="Play Race To Win">
        <Image
          className="gameplay-preview__poster"
          src="/images/race-to-win-hero.png"
          alt=""
          fill
          sizes="(max-width: 720px) calc(100vw - 2rem), min(1200px, calc(100vw - 3rem))"
        />
        <video
          className="gameplay-preview__video"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          poster="/images/race-to-win-hero.png"
          aria-hidden="true"
          tabIndex={-1}
        >
          {videoSrc ? <source src={videoSrc} type="video/mp4" /> : null}
        </video>
        <span className="gameplay-preview__shade" aria-hidden="true" />
        <span className="gameplay-preview__content">
          <span className="eyebrow">RACE TO WIN</span>
          <span className="gameplay-preview__title">GAMEPLAY PREVIEW</span>
          <span className="gameplay-preview__action">PLAY THE GAME <span aria-hidden="true">→</span></span>
        </span>
      </Link>
    </section>
  );
}
