"use client";

import { useEffect, useState } from "react";

export type PlayerLanguage = "en" | "es";
const STORAGE_KEY = "raceToWinLanguage";

// English is the only public website language. Keep the hook API for existing consumers.
export function usePlayerLanguage(): [PlayerLanguage, (language: PlayerLanguage) => void] {
  const [language] = useState<PlayerLanguage>("en");
  useEffect(() => {
    document.documentElement.lang = "en";
    try { window.localStorage.setItem(STORAGE_KEY, "en"); } catch { /* Storage may be disabled. */ }
  }, []);
  const chooseLanguage = (_next: PlayerLanguage) => {
    try { window.localStorage.setItem(STORAGE_KEY, "en"); } catch { /* Storage may be disabled. */ }
  };
  return [language, chooseLanguage];
}
