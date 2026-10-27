"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ButtonLink } from "@/components/ui/button-link";
import Link from "next/link";
import { FaqList } from "@/components/marketing/faq-list";
import { ROUTES } from "@/lib/routes";
import { usePlayerLanguage } from "@/lib/i18n/use-player-language";

type Props = { username: string | null; authenticated: boolean; owner: boolean; playHref: string };
const copy = {
  en: {
    lede: "A new competitive racing experience is in development. One track. One chance to own the run.",
    play: "PLAY", profile: "PROFILE", signIn: "SIGN IN",
    playNote: "PLAY opens the Race To Win game.",
    pool: "TOTAL PRIZE POOL", split: "Shared among the top 3 winners",
    prizeNote: "Planned tournament prizes. Eligibility and official rules apply.",
    built: "BUILT TO COMPETE", line: "The line will be clear.",
    rules: "Rules, verification processes, and any applicable conditions will be communicated before official competition features become available.",
    readRules: "READ THE RULES", control: "RACE CONTROL", faqTitle: "What you need to know.",
    faqs: [
      { question: "Is Race To Win live yet?", answer: "The game is playable. Official competition features will be announced separately." },
      { question: "How will the game work?", answer: "Official rules and entry requirements will be published before competitive features become available." },
      { question: "Will there be prizes?", answer: "A $20 total prize pool is planned for the top three winners. Prize eligibility, verification, and official terms must be confirmed before any competition begins." },
      { question: "Will I need an account?", answer: "Player accounts are available for sign-in and profile setup. Game access details will be shared before launch." },
    ],
  },
  es: {
    lede: "Una nueva experiencia de carreras competitivas está en desarrollo. Una pista. Una oportunidad para dominar la carrera.",
    play: "JUGAR", profile: "PERFIL", signIn: "INICIAR SESIÓN",
    playNote: "JUGAR abre el juego Race To Win.",
    pool: "PREMIOS TOTALES", split: "Repartidos entre los 3 primeros lugares",
    prizeNote: "Premios previstos para el torneo. Se aplican requisitos y reglas oficiales.",
    built: "HECHO PARA COMPETIR", line: "Las reglas estarán claras.",
    rules: "Las reglas, los procesos de verificación y las condiciones aplicables se comunicarán antes de activar las competencias oficiales.",
    readRules: "VER LAS REGLAS", control: "CONTROL DE CARRERA", faqTitle: "Lo que debes saber.",
    faqs: [
      { question: "¿Race To Win ya está disponible?", answer: "El juego está disponible para jugar. Las competencias oficiales se anunciarán por separado." },
      { question: "¿Cómo funcionará el juego?", answer: "Las reglas oficiales y los requisitos de participación se publicarán antes de activar las competencias." },
      { question: "¿Habrá premios?", answer: "Se prevé una bolsa total de $20 repartida entre los tres primeros lugares. Los requisitos, la verificación y las condiciones oficiales deben confirmarse antes del torneo." },
      { question: "¿Necesitaré una cuenta?", answer: "Puedes iniciar sesión y configurar tu perfil. Se publicarán más detalles antes del lanzamiento." },
    ],
  },
} as const;

export function LocalizedHome({ username, authenticated, owner, playHref }: Props) {
  const [language, setLanguage] = usePlayerLanguage();
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const t = copy[language];
  return (
    <>
      <section className="home-games-hero">
        <div className="home-games-backdrop" aria-hidden="true">
          <Image src="/images/race-to-win-hero.png" alt="" fill priority sizes="100vw" />
        </div>
        <div className="home-games-content shell">
          <div className="home-games-logo-banner"><Image src="/images/%20%20%20%20race-to-win-logo-banner.webp..PNG" alt="Race To Win" width={1536} height={512} unoptimized priority sizes="(max-width: 760px) calc(100vw - 3rem), 1120px" /></div>
          <div className="home-games-grid">
            <article className="home-game-tile home-game-tile--race">
              {username ? <p className="hero-player-name">{username}</p> : null}
              <div className="home-game-art home-game-art--race" aria-hidden="true" />
              <p className="eyebrow">RACING GAME</p>
              <h1>RACE <em>TO WIN</em></h1>
              <p className="home-game-description">{t.lede}</p>
              <div className="home-game-actions">
                <Link className="button button--primary" href={playHref}>{t.play}</Link>
                {owner ? <ButtonLink href="/admin/prize-review" variant="secondary">ADMIN</ButtonLink> : null}
              </div>
            </article>
            <article className="home-game-tile home-game-tile--flappy" aria-labelledby="flappy-title">
              <div className="home-game-art home-game-art--flappy" aria-hidden="true" />
              <p className="eyebrow">{language === "es" ? "JUEGO ARCADE" : "ARCADE GAME"}</p>
              <h2 id="flappy-title">FLAPPY <em>RACE</em></h2>
              <p className="home-game-description">{language === "es" ? "Vuela entre obstáculos, consigue puntos y supera tu récord. ¿Hasta dónde puedes llegar?" : "Fly between obstacles, collect points, and beat your high score. How far can you go?"}</p>
              <div className="home-game-actions">
                <Link href="/games/flappy-race" className="button button--primary">{language === "es" ? "JUGAR" : "PLAY"}</Link>
              </div>
            </article>
          </div>
          <aside className="home-games-prize" aria-label={language === "es" ? "Premios totales de 20 dólares para los tres primeros lugares" : "20 dollar total prize pool for the top three"}>
            <Image src="/images/racetowin-prize-banner.png.png" alt="Race To Win — $20 total prize pool shared among the top three winners" width={1536} height={512} sizes="(max-width: 760px) calc(100vw - 2rem), 1100px" />
          </aside>
        </div>
      </section>
      <section className="section shell two-column" aria-labelledby="fair-title">
        <div><p className="eyebrow">{t.built}</p><h2 id="fair-title">{t.line}</h2></div>
        <div><p>{t.rules}</p><ButtonLink href={ROUTES.rules} variant="secondary">{t.readRules}</ButtonLink></div>
      </section>
      <section className="section section-tint" id="access" aria-labelledby="faq-title">
        <div className="shell faq-layout">
          <div><p className="eyebrow">{t.control}</p><h2 id="faq-title">{t.faqTitle}</h2></div>
          <FaqList items={[...t.faqs]} />
        </div>
      </section>
    </>
  );
}
