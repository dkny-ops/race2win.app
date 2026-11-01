"use client";

import { useEffect, useRef } from "react";
import { SiteAudioSettings } from "./site-audio";

export function SiteLanguageSettings({ desktop = false }: { desktop?: boolean }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onOutside = (event: PointerEvent) => {
      if (detailsRef.current?.open && !detailsRef.current.contains(event.target as Node)) detailsRef.current.open = false;
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, []);
  return <details ref={detailsRef} className={`site-language-settings${desktop ? " site-language-settings--desktop" : ""}`}>
    <summary className="site-language-settings__trigger">SETTINGS</summary>
    <div className="site-language-settings__panel"><SiteAudioSettings /></div>
  </details>;
}
