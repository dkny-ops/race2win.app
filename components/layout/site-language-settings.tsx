"use client";

import { SiteAudioSettings } from "./site-audio";
import { useEffect, useId, useRef } from "react";
import { usePlayerLanguage } from "@/lib/i18n/use-player-language";

export function SiteLanguageSettings({ desktop = false }: { desktop?: boolean }) {
  const selectId = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onOutside = (event: PointerEvent) => {
      if (detailsRef.current?.open && !detailsRef.current.contains(event.target as Node)) detailsRef.current.open = false;
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, []);
  const [language, setLanguage] = usePlayerLanguage();
  return <details ref={detailsRef} className={`site-language-settings${desktop ? " site-language-settings--desktop" : ""}`}>
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
