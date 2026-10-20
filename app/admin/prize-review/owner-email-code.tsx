"use client";
import { useState } from "react";
export function OwnerEmailCode({ winnerId, playerId, alreadyPaid = false }: { playerId: string; winnerId?: string; alreadyPaid?: boolean }) {
  const [code, setCode] = useState("");
  const [closed, setClosed] = useState(alreadyPaid);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function generateCode() {
    const digits = new Uint32Array(1);
    crypto.getRandomValues(digits);
    setCode(String(digits[0] % 1000000).padStart(6, "0"));
    setMessage("");
  }
  async function confirmPayment() {
    if (busy || closed) return;
    if (!window.confirm("¿Confirmas que YA PAGASTE a este ganador? Esto desactivará su botón de WhatsApp.")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/winner-contact-close", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, confirmedPaidByOwner: true }), cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not confirm payment");
      setClosed(true);
      setMessage("WhatsApp desactivado para este ganador.");
    } catch { setMessage("No se pudo guardar el pago exitoso."); }
    finally { setBusy(false); }
  }
  return <div style={{ display: "grid", gap: "0.65rem", marginBottom: "1rem" }}>
    <button type="button" className="button" onClick={generateCode}>Generar Código</button>
    {code ? <div style={{ padding: "0.75rem", border: "1px solid rgba(255,255,255,.25)", borderRadius: 8, fontSize: "1.4rem", letterSpacing: "0.15em", fontWeight: 700 }} onClick={() => void navigator.clipboard?.writeText(code)} title="Pulsa para copiar el código">{code}</div> : null}
    <button type="button" className="button" disabled={busy || closed} onClick={() => void confirmPayment()}>{closed ? "Pago exitoso ✓" : busy ? "Guardando..." : "Pago exitoso"}</button>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
