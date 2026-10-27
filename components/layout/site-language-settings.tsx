"use client";

import { SiteAudioSettings } from "./site-audio";
import { useId } from "react";
import { usePlayerLanguage } from "@/lib/i18n/use-player-language";

export function SiteLanguageSettings({ desktop = false }: { desktop?: boolean }) {
  const selectId = useId();
  const [language, setLanguage] = usePlayerLanguage();
  return <details className={`site-language-settings${desktop ? " site-language-settings--desktop" : ""}`}>
    <summary className="site-language-settings__trigger">SETTINGS</summary>
    <div className="site-language-settings__panel">
      <label className="site-language-settings__label" htmlFor={selectId}>LANGUAGE / IDIOMA</label>
      <select className="site-language-settings__select" id={selectId} aria-label="Language / Idioma" value={language} onChange={event => setLanguage(event.target.value === "es" ? "es" : "en")}>
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
      <SiteAudioSettings />
    </div>
  </details>;
}
