"use client";

import { usePlayerLanguage } from "@/lib/i18n/use-player-language";

export function SiteLanguageSettings() {
  const [language, setLanguage] = usePlayerLanguage();
  return <details className="site-language-settings">
    <summary className="site-language-settings__trigger">SETTINGS</summary>
    <div className="site-language-settings__panel">
      <label className="site-language-settings__label" htmlFor="site-menu-language">LANGUAGE / IDIOMA</label>
      <select className="site-language-settings__select" id="site-menu-language" aria-label="Language / Idioma" value={language} onChange={event => setLanguage(event.target.value === "es" ? "es" : "en")}>
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
    </div>
  </details>;
}
