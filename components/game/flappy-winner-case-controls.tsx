"use client";

import { useState } from "react";

type Decision = "approved" | "rejected" | "needs_additional_review";

export function FlappyWinnerCaseControls({ week, playerId, state }: { week: string; playerId: string; state: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(decision: Decision) {
    setPending(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/flappy-race/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ week, playerId, decision }),
      });
      const body: unknown = await response.json().catch(() => null);
      const message = body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : response.ok ? "Decisión registrada." : "La decisión no pudo registrarse.";
      setStatus(message);
    } catch {
      setStatus("La decisión no pudo registrarse.");
    } finally {
      setPending(false);
    }
  }

  return <fieldset disabled={pending} style={{ border: "1px solid #475569", borderRadius: 8, padding: 12 }}>
    <legend>Decisión del candidato ({state})</legend>
    <p>La decisión, la cuenta administradora y la fecha se guardan automáticamente en el historial del expediente.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button type="button" onClick={() => submit("approved")}>Aprobar elegibilidad</button>
      <button type="button" onClick={() => submit("needs_additional_review")}>Solicitar más revisión</button>
      <button type="button" onClick={() => submit("rejected")}>Rechazar elegibilidad</button>
    </div>
    {status ? <p role="status">{status}</p> : null}
  </fieldset>;
}
