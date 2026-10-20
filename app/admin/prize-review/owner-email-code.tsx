"use client";
import { useState } from "react";
export function OwnerEmailCode({ winnerId }: { playerId: string; winnerId?: string }) {
  const [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function generateCode() {
    const digits = new Uint32Array(1);
    crypto.getRandomValues(digits);
    setCode(String(digits[0] % 1000000).padStart(6, "0"));
    setMessage("Código generado. Envíalo personalmente al correo registrado del jugador.");
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(code); setMessage("Código copiado."); }
    catch { setMessage("No se pudo copiar automáticamente. Selecciona el código."); }
  }
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
  return <div style={{ display: "grid", gap: "0.65rem", marginBottom: "1rem" }}>
    <button type="button" className="button" onClick={generateCode}>GENERAR CÓDIGO</button>
    {code ? <>
      <div style={{ padding: "0.75rem", border: "1px solid rgba(255,255,255,.25)", borderRadius: 8, fontSize: "1.4rem", letterSpacing: "0.15em", fontWeight: 700 }}>{code}</div>
      <button type="button" className="button" onClick={() => void copyCode()}>COPIAR CÓDIGO</button>
    </> : null}
    <label><input type="checkbox" checked={confirmed} disabled={closed || busy || !winnerId} onChange={event => setConfirmed(event.target.checked)} /> Confirmo que ya pagué personalmente a este ganador.</label>
    <button type="button" className="button" disabled={!winnerId || !confirmed || busy || closed} onClick={() => void confirmPayment()}>{closed ? "PAGO CONFIRMADO · WHATSAPP DESACTIVADO" : busy ? "GUARDANDO..." : "PAGO CONFIRMADO"}</button>
    <p>La generación del código no registra cotejos ni pagos. Confirmar el pago desactiva WhatsApp solo para este ganador, sin modificar balances.</p>
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}
