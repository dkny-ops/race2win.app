"use client";

import { useEffect, useState } from "react";

export type PlayerLanguage = "en" | "es";
const STORAGE_KEY = "raceToWinLanguage";

export function usePlayerLanguage(): [PlayerLanguage, (language: PlayerLanguage) => void] {
  const [language, setLanguage] = useState<PlayerLanguage>("en");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      const detected = navigator.languages?.[0] || navigator.language || "en";
      setLanguage(saved === "en" || saved === "es" ? saved : detected.toLowerCase().startsWith("es") ? "es" : "en");
    } catch {
      setLanguage((navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en");
    }
  }, []);
  const chooseLanguage = (next: PlayerLanguage) => {
    setLanguage(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* Storage may be disabled. */ }
    window.dispatchEvent(new Event("rtw-language-change"));
  };
  useEffect(() => {
    const sync = () => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved === "en" || saved === "es") setLanguage(saved);
      } catch { /* Ignore blocked storage. */ }
    };
    window.addEventListener("rtw-language-change", sync);
    return () => window.removeEventListener("rtw-language-change", sync);
  }, []);
  return [language, chooseLanguage];
}

export function PlayerLanguageSelector() {
  const [language, setLanguage] = usePlayerLanguage();
  return <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
    <span>{language === "es" ? "Idioma" : "Language"}</span>
    <select aria-label="Language / Idioma" value={language} onChange={(event) => setLanguage(event.target.value as PlayerLanguage)}>
      <option value="en">English</option>
      <option value="es">Español</option>
    </select>
  </label>;
}
