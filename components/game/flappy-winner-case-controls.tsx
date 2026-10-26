"use client";

import { useState } from "react";

type Decision = "approved" | "rejected" | "needs_additional_review";

export function FlappyWinnerCaseControls({ week, playerId, state }: { week: string; playerId: string; state: string }) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(decision: Decision) {
    const trimmed = note.trim();
    if (trimmed.length < 1 || trimmed.length > 500) {
      setStatus("Incluye una justificación de 1 a 500 caracteres.");
      return;
    }
    setPending(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/flappy-race/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ week, playerId, decision, note: trimmed }),
      });
      const body: unknown = await response.json().catch(() => null);
      const message = body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : response.ok ? "Decisión registrada." : "La decisión no pudo registrarse.";
      setStatus(message);
      if (response.ok) setNote("");
    } catch {
      setStatus("La decisión no pudo registrarse.");
    } finally {
      setPending(false);
    }
  }

  return <fieldset disabled={pending} style={{ border: "1px solid #475569", borderRadius: 8, padding: 12 }}>
    <legend>Decisión del candidato ({state})</legend>
    <label htmlFor={"flappy-note-" + playerId}>Justificación de auditoría</label>
    <textarea id={"flappy-note-" + playerId} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} style={{ display: "block", width: "100%", marginBlock: 8 }} />
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button type="button" onClick={() => submit("approved")}>Aprobar elegibilidad</button>
      <button type="button" onClick={() => submit("needs_additional_review")}>Solicitar más revisión</button>
      <button type="button" onClick={() => submit("rejected")}>Rechazar elegibilidad</button>
    </div>
    {status ? <p role="status">{status}</p> : null}
  </fieldset>;
}
