"use client";

import { useId } from "react";
import { usePlayerLanguage } from "@/lib/i18n/use-player-language";

export function SiteLanguageSettings({ desktop = false }: { desktop?: boolean }) {
  const selectId = useId();
  const [language, setLanguage] = usePlayerLanguage();
  return <details className="site-language-settings" style={{ padding: "0.75rem 0", position: "relative" }}>
    <summary style={{ cursor: "pointer", fontWeight: 700, letterSpacing: ".12em", color: "#fff" }}>SETTINGS</summary>
    <div style={desktop ? { position: "absolute", right: 0, top: "100%", width: 220, padding: "1rem", background: "#101827", border: "1px solid #60a5fa", borderRadius: 8, zIndex: 100 } : { padding: "1rem 0 .25rem" }}>
      <label htmlFor={selectId} style={{ display: "block", marginBottom: ".5rem", color: "#fff" }}>LANGUAGE / IDIOMA</label>
      <select id={selectId} aria-label="Language / Idioma" value={language} onChange={event => setLanguage(event.target.value === "es" ? "es" : "en")} style={{ display: "block", width: "100%", padding: ".75rem", borderRadius: 8, background: "#101827", color: "#fff", border: "1px solid #60a5fa", fontSize: "1rem" }}>
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
    </div>
  </details>;
}
