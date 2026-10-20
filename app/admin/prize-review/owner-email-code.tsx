"use client";
import { useState } from "react";
export function OwnerEmailCode({ winnerId }: { playerId: string; winnerId?: string }) {
  const [confirmed, setConfirmed] = useState(false);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function confirmPayment() {
    if (!winnerId || !confirmed || busy || closed) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/winner-contact-close", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winnerId, confirmedPaidByOwner: true }), cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not confirm payment");
      setClosed(true);
      setMessage("Pago confirmado por el propietario. WhatsApp desactivado para este ganador.");
    } catch { setMessage("No se pudo guardar la confirmación. Inténtalo nuevamente."); }
    finally { setBusy(false); }
  }
  return <div style={{ display: "grid", gap: "0.5rem", marginBottom: "1rem" }}>
    <label><input type="checkbox" checked={confirmed} disabled={closed || busy || !winnerId} onChange={event => setConfirmed(event.target.checked)} /> Confirmo que ya pagué personalmente a este ganador.</label>
    <button type="button" className="button" disabled={!winnerId || !confirmed || busy || closed} onClick={() => void confirmPayment()}>{closed ? "PAGO CONFIRMADO · WHATSAPP DESACTIVADO" : busy ? "GUARDANDO..." : "PAGO CONFIRMADO"}</button>
    <p>Registra tu confirmación y desactiva WhatsApp solo para este ganador. No transfiere dinero ni modifica balances.</p>
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}
