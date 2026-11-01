"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TurnstileScript } from "@/app/sign-in/turnstile-widget";
import { FlappyInvisibleVerification, type FlappyCheck, type FlappyCheckConfiguration } from "@/lib/game/flappy/invisible-verification";

export function useFlappyInvisibleCheck() {
  const controller = useRef<FlappyInvisibleVerification | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [loadScript, setLoadScript] = useState(false);
  const [challenge, setChallenge] = useState<{ siteKey: string; nonce: string } | null>(null);
  const waiting = useRef<{ resolve: (token: string) => void; reject: () => void } | null>(null);
  const settle = useCallback((token?: string) => {
    const pending = waiting.current;
    waiting.current = null;
    if (token) pending?.resolve(token); else pending?.reject();
    setChallenge(null);
  }, []);
  const token = useCallback((siteKey: string, nonce: string) => new Promise<string>((resolve, reject) => {
    waiting.current?.reject();
    waiting.current = { resolve, reject: () => reject(new Error("Verification unavailable")) };
    setChallenge({ siteKey, nonce });
  }), []);
  useEffect(() => {
    if (!challenge) return;
    const timeout = window.setTimeout(() => settle(), 10000);
    return () => window.clearTimeout(timeout);
  }, [challenge, settle]);
  useEffect(() => {
    if (!challenge || !ready || !container.current || !window.turnstile) return;
    const api = window.turnstile;
    let active = true;
    let id: string | null = null;
    try {
      id = api.render(container.current, {
        sitekey: challenge.siteKey, action: "midrun_human_check", cData: challenge.nonce,
        size: "invisible", execution: "execute", appearance: "interaction-only",
        callback: value => { if (active) settle(value); },
        "error-callback": () => { if (active) settle(); },
        "expired-callback": () => { if (active) settle(); },
      });
      api.execute(id);
    } catch { queueMicrotask(() => { if (active) settle(); }); }
    return () => { active = false; if (id) api.remove(id); };
  }, [challenge, ready, settle]);
  const stop = useCallback(() => {
    controller.current?.stop(); controller.current = null;
    settle();
  }, [settle]);
  useEffect(() => () => { controller.current?.stop(); waiting.current?.reject(); waiting.current = null; }, []);
  const begin = useCallback((sessionId: string, config?: FlappyCheckConfiguration) => {
    stop();
    if (!config?.required) return;
    setLoadScript(true);
    const transport = async (body: { sessionId: string; nonce?: string; token?: string }): Promise<FlappyCheck> => {
      const response = await fetch("/api/flappy-race/sessions/human-check", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(6000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Verification unavailable");
      const data = await response.json() as FlappyCheck;
      if (typeof data.required !== "boolean" || !Number.isFinite(Date.parse(data.serverNow)) ||
          (data.required && (!Number.isFinite(Date.parse(data.nextDueAt!)) || typeof data.due !== "boolean"))) throw new Error("Invalid verification");
      return data;
    };
    controller.current = new FlappyInvisibleVerification(sessionId, config, transport, token);
    controller.current.start();
  }, [stop, token]);
  const finish = useCallback(async (collisionAt: number) => { await controller.current?.finish(collisionAt); }, []);
  const widget = <>
    {loadScript ? <TurnstileScript onReady={() => setReady(true)} onError={() => settle()} /> : null}
    <div ref={container} aria-hidden="true" style={{ position: "absolute", pointerEvents: "none" }} />
  </>;
  return { begin, finish, stop, widget };
}
