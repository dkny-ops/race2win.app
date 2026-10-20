"use client";
import { useState } from "react";
export function OwnerEmailCode({ winnerId, playerId, alreadyPaid = false }: { playerId: string; winnerId?: string; alreadyPaid?: boolean }) {
  const [code, setCode] = useState("");
  const [closed, setClosed] = useState(alreadyPaid);
  const [busy, setBusy] = useState(false);
  const [validated, setValidated] = useState(false);
  const [message, setMessage] = useState("");
  function generateCode() {
    const digits = new Uint32Array(1);
    crypto.getRandomValues(digits);
    setCode(String(digits[0] % 1000000).padStart(6, "0"));
    setMessage("");
  }
  async function validateBalance() {
    if (busy || validated || closed) return;
    if (!window.confirm("¿Confirmas que revisaste las partidas y autorizas acreditar el premio al AVAILABLE BALANCE?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/validate-winner-balance", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerId,confirmedReviewed:true}),cache:"no-store"});
      if (!response.ok) {
        const error = await response.json().catch(() => null) as {message?:string} | null;
        throw new Error(error?.message || "No se pudo validar el balance");
      }
      setValidated(true);
      setMessage("Balance validado y acreditado por el servidor.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo validar el balance."); }
    finally { setBusy(false); }
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
      if (!response.ok) { const details = await response.json().catch(() => null) as {message?:string} | null; throw new Error(details?.message || "No se pudo registrar el pago"); }
      setClosed(true);
      setMessage("Pago registrado correctamente. El balance disponible quedó en $0.00.");
      window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar el pago exitoso."); }
    finally { setBusy(false); }
  }
  return <div style={{ display: "grid", gap: "0.65rem", marginBottom: "1rem" }}>
    <button type="button" className="button" onClick={generateCode}>Generar Código</button>
    {code ? <div style={{ padding: "0.75rem", border: "1px solid rgba(255,255,255,.25)", borderRadius: 8, fontSize: "1.4rem", letterSpacing: "0.15em", fontWeight: 700 }} onClick={() => void navigator.clipboard?.writeText(code)} title="Pulsa para copiar el código">{code}</div> : null}
    <button type="button" className="button" disabled={busy || closed || validated} onClick={() => void validateBalance()}>{validated ? "Balance validado ✓" : "Validar balance"}</button>
    <button type="button" className="button" disabled={busy || closed} onClick={() => void confirmPayment()}>{closed ? "Pago exitoso ✓" : busy ? "Guardando..." : "Pago exitoso"}</button>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
