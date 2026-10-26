"use client";

import { useState } from "react";

type Action = "approved" | "rejected" | "needs_additional_review" | "allocate";

export function FlappyPrizeCaseControls({ week, playerId, state }: { week: string; playerId: string; state: string }) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(action: Action) {
    const trimmed = note.trim();
    if (trimmed.length < 1 || trimmed.length > 500) {
      setStatus("Provide an audit note of 1 to 500 characters.");
      return;
    }
    setPending(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/flappy-race/prizes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ week, playerId, action, note: trimmed }),
      });
      const body: unknown = await response.json().catch(() => null);
      setStatus(body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : response.ok ? "Decision recorded." : "Decision unavailable.");
      if (response.ok) setNote("");
    } catch {
      setStatus("Decision unavailable.");
    } finally {
      setPending(false);
    }
  }

  return <fieldset disabled={pending} style={{ border: "1px solid #475569", borderRadius: 8, padding: 12 }}>
    <legend>Prize decision ({state})</legend>
    <label htmlFor={"flappy-prize-note-" + playerId}>Audit justification</label>
    <textarea id={"flappy-prize-note-" + playerId} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} style={{ display: "block", width: "100%", marginBlock: 8 }} />
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {state === "approved"
        ? <button type="button" onClick={() => submit("allocate")}>Approve shared-balance credit</button>
        : <>
          <button type="button" onClick={() => submit("approved")}>Approve eligibility</button>
          <button type="button" onClick={() => submit("needs_additional_review")}>Request more review</button>
          <button type="button" onClick={() => submit("rejected")}>Reject eligibility</button>
        </>}
    </div>
    <p>No option executes a payment. Shared-balance credit is only available after eligibility approval.</p>
    {status ? <p role="status">{status}</p> : null}
  </fieldset>;
}
