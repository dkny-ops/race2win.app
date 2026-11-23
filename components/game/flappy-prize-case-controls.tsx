"use client";

import { useState } from "react";

type Action = "approved" | "rejected" | "needs_additional_review" | "allocate";

export function FlappyPrizeCaseControls({ week, playerId, state }: { week: string; playerId: string; state: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(action: Action) {
    setPending(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/flappy-race/prizes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ week, playerId, action }),
      });
      const body: unknown = await response.json().catch(() => null);
      setStatus(body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : response.ok ? "Decision recorded." : "Decision unavailable.");
    } catch {
      setStatus("Decision unavailable.");
    } finally {
      setPending(false);
    }
  }

  return <fieldset disabled={pending} style={{ border: "1px solid #475569", borderRadius: 8, padding: 12 }}>
    <legend>Prize decision ({state})</legend>
    <p>The decision, owner account, and timestamp are recorded automatically in the audit history.</p>
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
