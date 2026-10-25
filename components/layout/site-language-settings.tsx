"use client";

import { usePlayerLanguage } from "@/lib/i18n/use-player-language";

export function SiteLanguageSettings() {
  const [language, setLanguage] = usePlayerLanguage();
  return <details className="site-language-settings" style={{ padding: "0.75rem 0" }}>
    <summary style={{ cursor: "pointer", fontWeight: 700, letterSpacing: ".12em", color: "#fff" }}>SETTINGS</summary>
    <div style={{ padding: "1rem 0 .25rem" }}>
      <label htmlFor="site-menu-language" style={{ display: "block", marginBottom: ".5rem", color: "#fff" }}>LANGUAGE / IDIOMA</label>
      <select id="site-menu-language" aria-label="Language / Idioma" value={language} onChange={event => setLanguage(event.target.value === "es" ? "es" : "en")} style={{ display: "block", width: "100%", padding: ".75rem", borderRadius: 8, background: "#101827", color: "#fff", border: "1px solid #60a5fa", fontSize: "1rem" }}>
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
    </div>
  </details>;
}
