"use client";
import { useState } from "react";

type RequestRow = { id: string; playerId: string; amountCents: number; status: string };
export function PayoutEmailReview({ requests }: { requests: RequestRow[] }) {
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  async function action(id: string, endpoint: string, body: Record<string, unknown>) {
    setBusy(id);
    setMessages((old) => ({ ...old, [id]: "" }));
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const data = await response.json() as { code?: string; message?: string; verified?: boolean };
      if (!response.ok) {
        setMessages((old) => ({ ...old, [id]: data.message ?? "Action failed" }));
        return;
      }
      if (typeof data.code === "string") setCodes((old) => ({ ...old, [id]: data.code as string }));
      if (data.verified) {
        setCodes((old) => { const next = { ...old }; delete next[id]; return next; });
        setConfirmed((old) => ({ ...old, [id]: false }));
      }
      setMessages((old) => ({ ...old, [id]: data.verified ? "Manual comparison recorded. No payout authorized." : "Code generated; send to registered email." }));
    } catch {
      setMessages((old) => ({ ...old, [id]: "Request failed" }));
    } finally { setBusy(null); }
  }
  return <div>
    {requests.length === 0 ? <p>No open payout requests.</p> : requests.map((item) =>
      <article key={item.id} className="profile-card" style={{ marginTop: "1rem" }}>
        <p>Player {item.playerId.slice(0, 8)} · {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(item.amountCents / 100)} · {item.status}</p>
        <p>Request ID: {item.id}</p>
        <button type="button" className="button" disabled={busy !== null} onClick={() => void action(item.id, "/api/admin/payout-email-code", { payoutId: item.id })}>GENERATE CODE</button>
        {codes[item.id] ? <div>
          <p>Temporary code: <strong>{codes[item.id]}</strong></p>
          <button type="button" className="button" onClick={() => {
            void navigator.clipboard.writeText(codes[item.id]).then(
              () => setMessages((old) => ({ ...old, [item.id]: "Code copied. Send to registered email only." })),
              () => setMessages((old) => ({ ...old, [item.id]: "Copy failed; select code manually." }))
            );
          }}>COPY CODE</button>
          <p>Compare the code sent to the registered email with the code returned through WhatsApp. This is an owner attestation, not independent email authentication.</p>
          <label><input type="checkbox" checked={confirmed[item.id] ?? false} onChange={(event) => setConfirmed((old) => ({ ...old, [item.id]: event.target.checked }))} /> I personally compared the matching code and player account.</label>
          <button type="button" className="button" disabled={busy !== null || !confirmed[item.id]} onClick={() => void action(item.id, "/api/admin/payout-email-verify", { payoutId: item.id, confirmedManualMatch: true })}>VERIFY</button>
        </div> : null}
        <p role="status" aria-live="polite">{messages[item.id]}</p>
      </article>
    )}
  </div>;
}
