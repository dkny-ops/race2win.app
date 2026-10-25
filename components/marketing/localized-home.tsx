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
      <section className="section shell" aria-labelledby="flappy-title" style={{ maxWidth: 1040, paddingTop: "2.5rem", paddingBottom: "2.5rem" }}>
        <div style={{ position: "relative", overflow: "hidden", borderRadius: 28, border: "1px solid rgba(103,232,249,.28)", background: "linear-gradient(135deg,rgba(12,35,58,.78),rgba(9,16,31,.62) 65%,rgba(18,63,77,.56))", boxShadow: "0 20px 60px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.1)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", padding: "clamp(1.5rem,5vw,3rem)" }}>
          <div aria-hidden="true" style={{ position: "absolute", right: "-65px", top: "-90px", width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle,rgba(34,211,238,.19),transparent 70%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "2rem" }}>
            <div style={{ flex: "1 1 280px", minWidth: 0 }}>
              <p className="eyebrow" style={{ color: "#67e8f9", letterSpacing: ".18em", marginBottom: ".75rem" }}>{language === "es" ? "NUEVO · JUEGO ARCADE" : "NEW · ARCADE GAME"}</p>
              <h2 id="flappy-title" style={{ fontSize: "clamp(2rem,5vw,3.6rem)", lineHeight: 1.05, letterSpacing: "-.035em", marginBottom: "1rem" }}>FLAPPY <span style={{ color: "#67e8f9" }}>RACE</span></h2>
              <p style={{ maxWidth: 410, opacity: .84, lineHeight: 1.65, marginBottom: "1.5rem" }}>{language === "es" ? "Vuela entre obstáculos, consigue puntos y supera tu récord. ¿Hasta dónde puedes llegar?" : "Fly between obstacles, collect points, and beat your high score. How far can you go?"}</p>
              <Link href="/games/flappy-race" className="button button--primary" style={{ display: "inline-flex", alignItems: "center", gap: ".6rem", borderRadius: 12, padding: ".9rem 2rem", fontWeight: 800 }}>{language === "es" ? "▶ JUGAR AHORA" : "▶ PLAY NOW"}</Link>
              <p style={{ marginTop: "1rem", fontSize: ".78rem", opacity: .58 }}>{language === "es" ? "DEMO GRATUITA · SIN PREMIOS" : "FREE DEMO · NO PRIZES"}</p>
            </div>
            <div aria-hidden="true" style={{ flex: "0 1 275px", width: "100%", maxWidth: 275, minHeight: 200, borderRadius: 22, border: "1px solid rgba(103,232,249,.2)", background: "linear-gradient(180deg,rgba(19,72,96,.65),rgba(5,20,37,.8))", display: "grid", placeItems: "center", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, bottom: "62%", left: "20%", width: 52, borderRadius: "0 0 9px 9px", background: "linear-gradient(90deg,#0891b2,#67e8f9)" }} />
              <div style={{ position: "absolute", bottom: 0, top: "62%", right: "20%", width: 52, borderRadius: "9px 9px 0 0", background: "linear-gradient(90deg,#0891b2,#67e8f9)" }} />
              <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#facc15", boxShadow: "0 0 36px rgba(250,204,21,.35)", zIndex: 1, display: "grid", placeItems: "center", color: "#172033", fontSize: "1.4rem", fontWeight: 900 }}>➤</div>
            </div>
          </div>
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
