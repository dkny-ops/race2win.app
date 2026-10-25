"use client";

import { useCallback, useEffect, useRef } from "react";
import Script from "next/script";

type TurnstileApi = Readonly<{
  render: (container: HTMLElement, options: Readonly<{
    sitekey: string;
    action: "otp_request" | "weekly_leader_verification" | "midrun_human_check";
    size: "flexible" | "invisible";
    execution?: "execute";
    appearance?: "interaction-only";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }>) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}>;

declare global { interface Window { turnstile?: TurnstileApi; } }

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function TurnstileScript({ onReady, onError }: Readonly<{ onReady: () => void; onError: () => void }>) {
  return <Script src={SCRIPT_URL} strategy="afterInteractive" onReady={onReady} onError={onError} />;
}

/** Collects a token only. The server verifies it and controls authorization. */
export function TurnstileWidget({ siteKey, scriptReady, resetNonce, label, onTokenChange, action = "otp_request", adaptive = false }: Readonly<{
  adaptive?: boolean;
  action?: "otp_request" | "weekly_leader_verification";
  siteKey: string;
  scriptReady: boolean;
  resetNonce: number;
  label: string;
  onTokenChange: (token: string | null) => void;
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const clearAndReset = useCallback(() => {
    onTokenChange(null);
    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  }, [onTokenChange]);

  useEffect(() => {
    if (!scriptReady || !containerRef.current || !window.turnstile) return;
    const api = window.turnstile;
    let active = true;
    onTokenChange(null);
    const id = api.render(containerRef.current, {
      sitekey: siteKey, action, size: "flexible",
      ...(adaptive ? { appearance: "interaction-only" as const } : {}),
      callback: (token) => { if (active) onTokenChange(token); },
      "expired-callback": () => { if (active) clearAndReset(); },
      "error-callback": () => { if (active) clearAndReset(); },
    });
    widgetIdRef.current = id;
    return () => { active = false; widgetIdRef.current = null; onTokenChange(null); api.remove(id); };
  }, [action, adaptive, clearAndReset, onTokenChange, scriptReady, siteKey]);

  useEffect(() => {
    if (resetNonce > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onTokenChange(null);
    }
  }, [onTokenChange, resetNonce]);

  return <div className="turnstile-widget" aria-label={label}><div ref={containerRef} /></div>;
}
