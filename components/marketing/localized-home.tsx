"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ButtonLink } from "@/components/ui/button-link";
import Link from "next/link";
import { FaqList } from "@/components/marketing/faq-list";
import { ROUTES } from "@/lib/routes";

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
  const [language, setLanguage] = useState<"en" | "es">("en");
  useEffect(() => {
    const locale = navigator.languages?.[0] || navigator.language || "en";
    const next = locale.toLowerCase().startsWith("es") ? "es" : "en";
    setLanguage(next);
    document.documentElement.lang = next;
  }, []);
  const t = copy[language];
  return (
    <>
      <section className="hero">
        <div className="hero-visual" aria-hidden="true">
          <Image src="/images/race-to-win-hero.png" alt="" fill priority sizes="100vw" />
        </div>
        <div className="shell hero-grid">
          <div className="hero-copy">
            {username ? <p className="hero-player-name">{username}</p> : null}
            <h1>RACE <em>TO WIN</em></h1>
            <p className="hero-lede">{t.lede}</p>
            <div className="button-row">
              <Link className="button button--primary" href={playHref}>{t.play}</Link>
              {owner ? <ButtonLink href="/admin/prize-review" variant="secondary">ADMIN</ButtonLink> : null}
              {authenticated ? <ButtonLink href={ROUTES.profile} variant="secondary">{t.profile}</ButtonLink> : <ButtonLink href={ROUTES.signIn} variant="secondary">{t.signIn}</ButtonLink>}
            </div>
            <p className="play-note">{t.playNote}</p>
          </div>
        </div>
      <aside className="shell prize-promo" aria-label={language === "es" ? "Premios previstos: 20 dólares repartidos entre los tres primeros lugares. Se aplican reglas oficiales." : "Planned 20 dollar prize pool shared among the top three winners. Official rules apply."}>
        <Image
          className="prize-promo__banner-image"
          src="/images/racetowin-prize-banner.png.png"
          alt="Race To Win — $20 total prize pool, shared among the top 3 winners. Planned tournament prizes; eligibility and official rules apply."
          width={1536}
          height={512}
          sizes="(max-width: 720px) calc(100vw - 2rem), 850px"
        />
      </aside>
      </section>
      <section className="section shell" aria-labelledby="flappy-title" style={{ maxWidth: 800, paddingTop: "2rem", paddingBottom: "2rem" }}>
        <h2 id="flappy-title" style={{ textAlign: "center", marginBottom: "1rem" }}>FLAPPY RACE · MINI GAME</h2>
        <p style={{ textAlign: "center", marginBottom: "1rem" }}>{language === "es" ? "Vuela, esquiva obstáculos y supera tu récord. Demo gratuita sin premios." : "Fly, dodge obstacles, and beat your score. Free demo without prizes."}</p>
        <div style={{ textAlign: "center" }}><Link href="/games/flappy-race" className="button button--primary">{language === "es" ? "PLAY · JUGAR" : "PLAY"}</Link></div>
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
