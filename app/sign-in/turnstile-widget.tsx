"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";

type TurnstileApi = Readonly<{
  render: (container: HTMLElement, options: Readonly<{
    sitekey: string;
    action: "otp_request";
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

type TurnstileWidgetProps = Readonly<{
  siteKey: string;
  onTokenChange: (token: string | null) => void;
  resetNonce: number;
}>;

/** Client-side collection only. The server remains the verifier and authority. */
export function TurnstileWidget({ siteKey, onTokenChange, resetNonce }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const clearTokenAndReset = useCallback(() => {
    onTokenChange(null);
    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  }, [onTokenChange]);

  const renderWidget = useCallback(() => {
    if (!containerRef.current || widgetIdRef.current || !window.turnstile) return;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: "otp_request",
      size: "flexible",
      callback: (token) => onTokenChange(token),
      "expired-callback": clearTokenAndReset,
      "error-callback": clearTokenAndReset,
    });
  }, [clearTokenAndReset, onTokenChange, siteKey]);

  useEffect(() => {
    if (scriptReady) renderWidget();
  }, [renderWidget, scriptReady]);

  useEffect(() => () => {
    if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
  }, []);

  useEffect(() => {
    if (resetNonce > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onTokenChange(null);
    }
  }, [onTokenChange, resetNonce]);

  return <div className="turnstile-widget" aria-label="Human verification">
    <Script src={TURNSTILE_SCRIPT_URL} strategy="afterInteractive" onLoad={() => setScriptReady(true)} onError={() => onTokenChange(null)} />
    <div ref={containerRef} />
  </div>;
}
