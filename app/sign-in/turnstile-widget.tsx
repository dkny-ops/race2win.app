"use client";

import { useCallback, useEffect, useRef } from "react";
import Script from "next/script";
import type { TurnstileAction } from "@/lib/security/turnstile";

type TurnstileApi = Readonly<{
  render: (container: HTMLElement, options: Readonly<{
    sitekey: string;
    action: TurnstileAction;
    size: "flexible";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}>;

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** One loader per form: duplicate Next Script instances can miss onReady. */
export function TurnstileScript({ onReady, onError }: { onReady: () => void; onError: () => void }) {
  return <Script src={TURNSTILE_SCRIPT_URL} strategy="afterInteractive" onReady={onReady} onError={onError} />;
}

type TurnstileWidgetProps = Readonly<{
  siteKey: string;
  onTokenChange: (token: string | null) => void;
  resetNonce: number;
  action?: TurnstileAction;
  label?: string;
  scriptReady: boolean;
}>;

/** Client-side collection only. The server remains the verifier and authority. */
export function TurnstileWidget({ siteKey, onTokenChange, resetNonce, scriptReady, action = "otp_request", label = "Human verification" }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const clearTokenAndReset = useCallback(() => {
    onTokenChange(null);
    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  }, [onTokenChange]);

  useEffect(() => {
    if (!scriptReady || !containerRef.current || !window.turnstile) return;
    const api = window.turnstile;
    let active = true;
    onTokenChange(null);
    const widgetId = api.render(containerRef.current, {
      sitekey: siteKey,
      action,
      size: "flexible",
      callback: (token) => { if (active) onTokenChange(token); },
      "expired-callback": () => { if (active) clearTokenAndReset(); },
      "error-callback": () => { if (active) clearTokenAndReset(); },
    });
    widgetIdRef.current = widgetId;
    // Pair setup/cleanup so Strict Mode and navigation recreate both widgets.
    return () => {
      active = false;
      widgetIdRef.current = null;
      onTokenChange(null);
      api.remove(widgetId);
    };
  }, [action, clearTokenAndReset, onTokenChange, scriptReady, siteKey]);

  useEffect(() => {
    if (resetNonce > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onTokenChange(null);
    }
  }, [onTokenChange, resetNonce]);

  return <div className="turnstile-widget" aria-label={label}>
    <div ref={containerRef} />
  </div>;
}
