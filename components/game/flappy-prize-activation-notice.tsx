"use client";

import { useEffect, useState } from "react";

type Status = { prizesEnabled?: boolean; prizeEffectiveAt?: string | null; prizeInauguralWeekStart?: string | null };

export function FlappyPrizeActivationNotice({ language }: { language: "en" | "es" }) {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/flappy-race/tournament", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<Status> : null)
      .then((value) => setStatus(value))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!status?.prizesEnabled || typeof status.prizeEffectiveAt !== "string") return null;
  const es = language === "es";
  const effective = new Date(status.prizeEffectiveAt).toLocaleString(es ? "es-US" : "en-US", { timeZone: "America/New_York" });
  return <p className="scores-message" role="status">
    {es
      ? <>PREMIOS ACTIVOS DESDE {effective} (Nueva York). Sólo cuentan las partidas iniciadas después de esa hora para el período inaugural.</>
      : <>PRIZES ACTIVE FROM {effective} (New York). Only runs started after that server time count in the inaugural period.</>}
  </p>;
}
