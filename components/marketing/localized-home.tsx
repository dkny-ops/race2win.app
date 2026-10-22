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
      <aside className="shell prize-promo" aria-label={t.pool}>
        <div className="prize-promo__inner">
          <div className="prize-promo__emblem" aria-hidden="true"><svg viewBox="0 0 240 210" focusable="false" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="prizeGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff8bc"/><stop offset=".28" stopColor="#f5bb32"/><stop offset=".55" stopColor="#aa5a05"/><stop offset=".8" stopColor="#ffdf68"/><stop offset="1" stopColor="#a75b0c"/></linearGradient><pattern id="raceChecks" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#f5f2e5"/><rect width="8" height="8" fill="#141414"/><rect x="8" y="8" width="8" height="8" fill="#141414"/></pattern></defs><g opacity=".9"><path d="M113 156 Q74 111 24 130 L38 151 Q73 130 113 172Z" fill="url(#raceChecks)" stroke="#b99140" strokeWidth="2"/><path d="M127 156 Q169 105 215 130 L199 151 Q162 132 127 172Z" fill="url(#raceChecks)" stroke="#b99140" strokeWidth="2"/><path d="M113 156 L33 95 M127 156 L209 95" stroke="#caa03c" strokeWidth="3"/></g><g fill="url(#prizeGold)" stroke="#ffe992" strokeWidth=".8"><ellipse cx="65.0" cy="157" rx="7" ry="15" transform="rotate(-48 65.0 157)"/><ellipse cx="175.0" cy="157" rx="7" ry="15" transform="rotate(48 175.0 157)"/><ellipse cx="60.2" cy="145" rx="7" ry="15" transform="rotate(-41 60.2 145)"/><ellipse cx="179.8" cy="145" rx="7" ry="15" transform="rotate(41 179.8 145)"/><ellipse cx="55.7" cy="133" rx="7" ry="15" transform="rotate(-34 55.7 133)"/><ellipse cx="184.3" cy="133" rx="7" ry="15" transform="rotate(34 184.3 133)"/><ellipse cx="51.4" cy="121" rx="7" ry="15" transform="rotate(-27 51.4 121)"/><ellipse cx="188.6" cy="121" rx="7" ry="15" transform="rotate(27 188.6 121)"/><ellipse cx="47.8" cy="109" rx="7" ry="15" transform="rotate(-20 47.8 109)"/><ellipse cx="192.2" cy="109" rx="7" ry="15" transform="rotate(20 192.2 109)"/><ellipse cx="44.8" cy="97" rx="7" ry="15" transform="rotate(-13 44.8 97)"/><ellipse cx="195.2" cy="97" rx="7" ry="15" transform="rotate(13 195.2 97)"/><ellipse cx="42.6" cy="85" rx="7" ry="15" transform="rotate(-6 42.6 85)"/><ellipse cx="197.4" cy="85" rx="7" ry="15" transform="rotate(6 197.4 85)"/><ellipse cx="41.3" cy="73" rx="7" ry="15" transform="rotate(1 41.3 73)"/><ellipse cx="198.7" cy="73" rx="7" ry="15" transform="rotate(-1 198.7 73)"/><ellipse cx="41.0" cy="61" rx="7" ry="15" transform="rotate(8 41.0 61)"/><ellipse cx="199.0" cy="61" rx="7" ry="15" transform="rotate(-8 199.0 61)"/></g><g fill="url(#prizeGold)" stroke="#ffe992" strokeWidth="1.5"><path d="M79 51H161L156 104Q149 127 120 132Q91 127 84 104Z"/><path d="M80 61H58Q49 61 51 78Q55 103 91 105L96 94Q66 95 64 76H82Z"/><path d="M160 61H182Q191 61 189 78Q185 103 149 105L144 94Q174 95 176 76H158Z"/><path d="M113 130H127V153H137V163H103V153H113Z"/><path d="M91 163H149L156 176H84Z"/><path d="M76 180H164V190H76Z"/></g><path d="M94 56H111L101 112Q91 102 90 78Z" fill="#fff3a2" opacity=".65"/></svg></div>
          <div className="prize-promo__message">
            <strong className="prize-promo__amount">$20</strong>
            <span className="prize-promo__caption">{t.pool}</span>
            <span className="prize-promo__split">{t.split}</span>
          </div>
          <span className="prize-promo__sparkle" aria-hidden="true">✦</span>
        </div>
        <p className="prize-promo__note">{t.prizeNote}</p>
      </aside>
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
